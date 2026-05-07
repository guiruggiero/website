# Imports
import boto3
import json
import subprocess
import sys
import time
import os
import base64

# Initializations
REGION = "us-west-2"
APP_NAME = "minimal-sonic-agent"
RUNTIME_NAME = "minimal_sonic_agent"
COGNITO_POOL_NAME = "MinimalSonicPool"
AGENT_ROLE_NAME = "MinimalSonicAgentRole"
COGNITO_ROLE_NAME = "MinimalSonicCognitoRole"
REPO_NAME = "minimal-sonic-agent"
WEBSOCKET_DIR = os.path.join(os.path.dirname(__file__), "..", "agentcore")
CONFIG_FILE = os.path.join(os.path.dirname(__file__), "setup_config.json")

# Print a prominent section header to the console
def step(msg):
    print(f"\n{'='*60}\n{msg}\n{'='*60}")

# Run a shell command and print it before executing
def run(cmd, **kwargs):
    print(f"  $ {' '.join(cmd)}")
    result = subprocess.run(cmd, check=True, **kwargs)
    return result

# Step 1: Create the ECR repo if needed, build the Docker image, and push it
def setup_ecr(account_id):
    step("Step 1/4: ECR — build and push Docker image")

    ecr = boto3.client("ecr", region_name=REGION)
    ecr_uri = f"{account_id}.dkr.ecr.{REGION}.amazonaws.com"
    image_uri = f"{ecr_uri}/{REPO_NAME}:latest"

    # Create repo (idempotent)
    try:
        ecr.create_repository(repositoryName=REPO_NAME)
        print(f"  Created ECR repo: {REPO_NAME}")
    except ecr.exceptions.RepositoryAlreadyExistsException:
        print(f"  ECR repo already exists: {REPO_NAME}")

    # Authenticate Docker to ECR using a short-lived token
    token = ecr.get_authorization_token()["authorizationData"][0]
    user, pwd = base64.b64decode(token["authorizationToken"]).decode().split(":", 1)
    run(["docker", "login", "--username", user, "--password-stdin", ecr_uri],
        input=pwd.encode(), capture_output=True)

    # Build for linux/arm64 — AgentCore containers run on ARM
    run(["docker", "buildx", "build", "--platform", "linux/arm64",
         "-t", image_uri, os.path.abspath(WEBSOCKET_DIR)])

    run(["docker", "push", image_uri])

    print(f"  Image pushed: {image_uri}")
    return image_uri

# Step 2: Create the IAM execution role that AgentCore will assume to run the container
def setup_agent_role(account_id):
    step("Step 2/4: IAM — create AgentCore execution role")

    iam = boto3.client("iam")

    trust = {
        "Version": "2012-10-17",
        "Statement": [{
            "Effect": "Allow",
            "Principal": {"Service": "bedrock-agentcore.amazonaws.com"},
            "Action": "sts:AssumeRole",
        }],
    }

    try:
        resp = iam.create_role(
            RoleName=AGENT_ROLE_NAME,
            AssumeRolePolicyDocument=json.dumps(trust),
            Description="Execution role for minimal Nova Sonic AgentCore runtime",
        )
        role_arn = resp["Role"]["Arn"]
        print(f"  Created role: {role_arn}")
    except iam.exceptions.EntityAlreadyExistsException:
        role_arn = iam.get_role(RoleName=AGENT_ROLE_NAME)["Role"]["Arn"]
        print(f"  Role already exists: {role_arn}")

    # Attach the managed policies needed for Bedrock, CloudWatch, and ECR access
    for policy in ["arn:aws:iam::aws:policy/AmazonBedrockFullAccess",
                   "arn:aws:iam::aws:policy/CloudWatchLogsFullAccess",
                   "arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly"]:
        iam.attach_role_policy(RoleName=AGENT_ROLE_NAME, PolicyArn=policy)

    # IAM changes take a few seconds to propagate before AgentCore can use the role
    print("  Waiting 10s for IAM propagation...")
    time.sleep(10)
    return role_arn

# Load deployment env vars from .env file (key=value, one per line, # comments ignored)
def _load_env_file(path):
    env = {}
    try:
        with open(path) as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, _, value = line.partition("=")
                env[key.strip()] = value.strip()
    except FileNotFoundError:
        pass
    return env

ENV_FILE = os.path.join(os.path.dirname(__file__), "..", ".env")
REQUIRED_ENV_VARS = ["LANGFUSE_SECRET_KEY", "LANGFUSE_PUBLIC_KEY"]

# Step 3: Create the AgentCore Runtime and poll until it reaches ACTIVE status
def setup_runtime(image_uri, role_arn, account_id):
    step("Step 3/4: AgentCore — create runtime")

    client = boto3.client("bedrock-agentcore-control", region_name=REGION)

    # Load only the required keys from .env — don't forward AWS creds or other local-only vars
    all_env = _load_env_file(ENV_FILE)
    missing = [k for k in REQUIRED_ENV_VARS if k not in all_env]
    if missing:
        print(f"  WARNING: Missing env vars in sonic/.env: {', '.join(missing)}")
    env_vars = {k: all_env[k] for k in REQUIRED_ENV_VARS if k in all_env}
    print(f"  Loaded env vars from sonic/.env: {', '.join(env_vars.keys())}")

    try:
        resp = client.create_agent_runtime(
            agentRuntimeName=RUNTIME_NAME,
            agentRuntimeArtifact={
                "containerConfiguration": {
                    "containerUri": image_uri,
                }
            },
            roleArn=role_arn,
            networkConfiguration={"networkMode": "PUBLIC"},
            protocolConfiguration={"serverProtocol": "HTTP"},
            environmentVariables=env_vars,
        )
        runtime_id = resp["agentRuntimeId"]
        runtime_arn = resp["agentRuntimeArn"]
        print(f"  Runtime created: {runtime_id}")
    except Exception as e:
        # Fetch the existing runtime if it was already created by a previous deploy
        if "already exists" in str(e).lower() or "ConflictException" in type(e).__name__:
            print("  Runtime already exists — fetching existing...")
            runtimes = client.list_agent_runtimes()["agentRuntimes"]
            match = next((r for r in runtimes if r["agentRuntimeName"] == RUNTIME_NAME), None)
            if not match:
                raise RuntimeError(f"Runtime '{RUNTIME_NAME}' exists but could not be listed")
            runtime_id = match["agentRuntimeId"]
            runtime_arn = match["agentRuntimeArn"]
        else:
            raise

    # Poll until ACTIVE — cold start typically takes 5-15 minutes
    print("  Waiting for runtime to become ACTIVE (this may take 5-15 min)...")
    for attempt in range(90):
        detail = client.get_agent_runtime(agentRuntimeId=runtime_id)
        status = detail.get("status", "UNKNOWN")
        print(f"  [{attempt+1}/90] Status: {status}", end="\r", flush=True)
        if status in ("ACTIVE", "READY"):
            print(f"\n  Runtime is {status}")
            break
        if status in ("FAILED", "DELETING"):
            raise RuntimeError(f"Runtime entered terminal state: {status}")
        time.sleep(20)
    else:
        raise TimeoutError("Runtime did not become ACTIVE within 30 minutes")

    return runtime_id, runtime_arn

# Step 4: Create a Cognito Identity Pool and a scoped IAM role so the browser can get temp creds
def setup_cognito(account_id, runtime_arn):
    step("Step 4/4: Cognito — create identity pool and browser role")

    cognito = boto3.client("cognito-identity", region_name=REGION)
    iam = boto3.client("iam")

    # Reuse an existing pool if one with the same name already exists
    pools = cognito.list_identity_pools(MaxResults=60)["IdentityPools"]
    match = next((p for p in pools if p["IdentityPoolName"] == COGNITO_POOL_NAME), None)
    if match:
        pool_id = match["IdentityPoolId"]
        print(f"  Cognito pool already exists: {pool_id}")
    else:
        pool = cognito.create_identity_pool(
            IdentityPoolName=COGNITO_POOL_NAME,
            AllowUnauthenticatedIdentities=True,
        )
        pool_id = pool["IdentityPoolId"]
        print(f"  Created Cognito pool: {pool_id}")

    # Trust policy: allow Cognito unauthenticated identities from this specific pool to assume the role
    trust = {
        "Version": "2012-10-17",
        "Statement": [{
            "Effect": "Allow",
            "Principal": {"Federated": "cognito-identity.amazonaws.com"},
            "Action": "sts:AssumeRoleWithWebIdentity",
            "Condition": {
                "StringEquals": {"cognito-identity.amazonaws.com:aud": pool_id},
                "ForAnyValue:StringLike": {"cognito-identity.amazonaws.com:amr": "unauthenticated"},
            },
        }],
    }

    # Permission policy: scoped to InvokeAgentRuntimeWithWebSocketStream on this runtime only
    permission_policy = {
        "Version": "2012-10-17",
        "Statement": [{
            "Effect": "Allow",
            "Action": "bedrock-agentcore:InvokeAgentRuntimeWithWebSocketStream",
            "Resource": f"{runtime_arn}*", # Trailing * is required, AgentCore evaluates the ARN with a suffix
        }],
    }

    try:
        resp = iam.create_role(
            RoleName=COGNITO_ROLE_NAME,
            AssumeRolePolicyDocument=json.dumps(trust),
            Description="Browser role for minimal Nova Sonic voice agent",
        )
        cognito_role_arn = resp["Role"]["Arn"]
        print(f"  Created Cognito role: {cognito_role_arn}")
    except iam.exceptions.EntityAlreadyExistsException:
        cognito_role_arn = iam.get_role(RoleName=COGNITO_ROLE_NAME)["Role"]["Arn"]
        print(f"  Cognito role already exists: {cognito_role_arn}")
        # Update the trust policy in case the pool ID changed
        iam.update_assume_role_policy(
            RoleName=COGNITO_ROLE_NAME,
            PolicyDocument=json.dumps(trust),
        )

    iam.put_role_policy(
        RoleName=COGNITO_ROLE_NAME,
        PolicyName="InvokeRuntime",
        PolicyDocument=json.dumps(permission_policy),
    )

    # Attach the role to the pool's unauthenticated identity slot
    cognito.set_identity_pool_roles(
        IdentityPoolId=pool_id,
        Roles={"unauthenticated": cognito_role_arn},
    )

    print(f"  Cognito pool configured")
    return pool_id

def main():
    # Resolve the AWS account ID for constructing ARNs and ECR URIs
    sts = boto3.client("sts", region_name=REGION)
    account_id = sts.get_caller_identity()["Account"]
    print(f"AWS account: {account_id}  region: {REGION}")

    # Run all four setup steps in order
    image_uri = setup_ecr(account_id)
    role_arn = setup_agent_role(account_id)
    runtime_id, runtime_arn = setup_runtime(image_uri, role_arn, account_id)
    pool_id = setup_cognito(account_id, runtime_arn)

    # Save resource IDs for cleanup.py to reference later
    config = {
        "region": REGION,
        "account_id": account_id,
        "runtime_id": runtime_id,
        "runtime_arn": runtime_arn,
        "identity_pool_id": pool_id,
        "image_uri": image_uri,
    }
    with open(CONFIG_FILE, "w") as f:
        json.dump(config, f, indent=2)

    # Build the WebSocket base URL by URL-encoding the runtime ARN
    runtime_arn_encoded = runtime_arn.replace(":", "%3A").replace("/", "%2F")
    runtime_wss = f"wss://bedrock-agentcore.{REGION}.amazonaws.com/runtimes/{runtime_arn_encoded}/ws"

    # Print the two constants the user needs to paste into sonic.js
    print("\n" + "="*60)
    print("DEPLOYMENT COMPLETE")
    print("="*60)
    print("\nUpdate these two constants in sonic.js and push changes to the website:\n")
    print(f'  const COGNITO_IDENTITY_POOL_ID = "{pool_id}";')
    print(f'  const RUNTIME_WSS_BASE = "{runtime_wss}";')
    print("\nConfig saved to scripts/setup_config.json")

if __name__ == "__main__":
    main()