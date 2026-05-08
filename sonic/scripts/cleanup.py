# Imports
import boto3
import json
import os
import time

# Initializations
REGION = "us-west-2"
AGENT_ROLE_NAME = "MinimalSonicAgentRole"
COGNITO_ROLE_NAME = "MinimalSonicCognitoRole"
REPO_NAME = "minimal-sonic-agent"
CONFIG_FILE = os.path.join(os.path.dirname(__file__), "setup_config.json")

# Print a prominent section header to the console
def step(msg):
    print(f"\n{'='*60}\n{msg}\n{'='*60}")

# Load resource IDs saved by deploy.py
def load_config():
    if not os.path.exists(CONFIG_FILE):
        raise FileNotFoundError(f"setup_config.json not found at {CONFIG_FILE}. Was deploy.py run?")
    with open(CONFIG_FILE) as f:
        return json.load(f)

# Delete the AgentCore Runtime and poll until it is fully removed
def delete_runtime(runtime_id):
    step(f"Deleting AgentCore Runtime: {runtime_id}")
    client = boto3.client("bedrock-agentcore-control", region_name=REGION)
    try:
        client.delete_agent_runtime(agentRuntimeId=runtime_id)

        # Poll until the runtime disappears or reports DELETED
        print("  Waiting for deletion...")
        for _ in range(60):
            try:
                detail = client.get_agent_runtime(agentRuntimeId=runtime_id)
                status = detail.get("status", "UNKNOWN")
                print(f"  Status: {status}", end="\r", flush=True)
                if status == "DELETED":
                    break
                time.sleep(10)
            except Exception as e:
                if "not found" in str(e).lower() or "ResourceNotFoundException" in type(e).__name__:
                    break
                raise
        print("\n  Runtime deleted")
    except Exception as e:
        if "not found" in str(e).lower() or "ResourceNotFoundException" in type(e).__name__:
            print("  Runtime not found (already deleted)")
        else:
            print(f"  Warning: {e}")

# Delete the Cognito Identity Pool
def delete_cognito_pool(pool_id):
    step(f"Deleting Cognito Identity Pool: {pool_id}")
    cognito = boto3.client("cognito-identity", region_name=REGION)
    try:
        cognito.delete_identity_pool(IdentityPoolId=pool_id)
        print("  Pool deleted")
    except Exception as e:
        print(f"  Warning: {e}")

# Detach all policies and delete the IAM role
def delete_iam_role(role_name):
    step(f"Deleting IAM role: {role_name}")
    iam = boto3.client("iam")
    try:
        # Detach managed policies before deletion
        attached = iam.list_attached_role_policies(RoleName=role_name)["AttachedPolicies"]
        for p in attached:
            iam.detach_role_policy(RoleName=role_name, PolicyArn=p["PolicyArn"])
            print(f"  Detached: {p['PolicyArn']}")

        # Delete inline policies before deletion
        inline = iam.list_role_policies(RoleName=role_name)["PolicyNames"]
        for name in inline:
            iam.delete_role_policy(RoleName=role_name, PolicyName=name)
            print(f"  Deleted inline policy: {name}")

        iam.delete_role(RoleName=role_name)
        print(f"  Role deleted: {role_name}")
    except iam.exceptions.NoSuchEntityException:
        print(f"  Role not found (already deleted): {role_name}")
    except Exception as e:
        print(f"  Warning: {e}")

# Delete the ECR repository and all its images
def delete_ecr_repo():
    step(f"Deleting ECR repository: {REPO_NAME}")
    ecr = boto3.client("ecr", region_name=REGION)
    try:
        ecr.delete_repository(repositoryName=REPO_NAME, force=True)  # force=True removes all images first
        print("  Repository deleted")
    except ecr.exceptions.RepositoryNotFoundException:
        print("  Repository not found (already deleted)")
    except Exception as e:
        print(f"  Warning: {e}")

def main():
    config = load_config()

    # Delete in reverse dependency order
    delete_runtime(config["runtime_id"])
    delete_cognito_pool(config["identity_pool_id"])
    delete_iam_role(COGNITO_ROLE_NAME)
    delete_iam_role(AGENT_ROLE_NAME)

    # ECR is kept by default since images take time to rebuild
    answer = input("\nDelete ECR repository and all images? [y/N] ").strip().lower()
    if answer == "y":
        delete_ecr_repo()
    else:
        print("  ECR repository kept")

    os.remove(CONFIG_FILE)
    print("\nCleanup complete. setup_config.json removed.")

if __name__ == "__main__":
    main()