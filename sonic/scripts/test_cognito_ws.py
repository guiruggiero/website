# Imports
import asyncio
import boto3
from botocore.auth import SigV4QueryAuth
from botocore.awsrequest import AWSRequest
from botocore.credentials import Credentials
import websockets

# Initializations
REGION = "us-west-2"
COGNITO_IDENTITY_POOL_ID = "us-west-2:c71bd164-55c9-4dba-9abd-fec92b8b5de4"
WSS_BASE = "wss://bedrock-agentcore.us-west-2.amazonaws.com/runtimes/arn%3Aaws%3Abedrock-agentcore%3Aus-west-2%3A250711740447%3Aruntime%2Fminimal_sonic_agent-XNEC1PGRQK/ws"
HTTPS_URL = WSS_BASE.replace("wss://", "https://") + "?qualifier=DEFAULT"
COGNITO_ROLE_ARN = "arn:aws:iam::250711740447:role/MinimalSonicCognitoRole"

# Replicate the browser's Cognito flow: get an identity ID, exchange it for an OpenID token, then assume the role via STS
def get_cognito_credentials():
    cognito = boto3.client("cognito-identity", region_name=REGION)

    # Get an unauthenticated Cognito identity ID for this pool
    resp = cognito.get_id(IdentityPoolId=COGNITO_IDENTITY_POOL_ID)
    identity_id = resp["IdentityId"]
    print(f"Cognito Identity ID: {identity_id}")

    # Exchange the identity ID for an OpenID token
    resp = cognito.get_open_id_token(IdentityId=identity_id)
    token = resp["Token"]
    print(f"Got OpenID token (first 40): {token[:40]}...")

    # Use the OpenID token to assume the Cognito role and get temporary AWS credentials
    sts = boto3.client("sts", region_name=REGION)
    resp = sts.assume_role_with_web_identity(
        RoleArn=COGNITO_ROLE_ARN,
        RoleSessionName="sonic-test",
        WebIdentityToken=token,
    )
    c = resp["Credentials"]
    print(f"Access Key: {c['AccessKeyId']}")
    print(f"Has session token: {bool(c['SessionToken'])}")
    return c

# Sign the AgentCore URL using the Cognito temp credentials (same algorithm as test_ws.py)
def get_presigned_url(cognito_creds):
    creds = Credentials(
        access_key=cognito_creds["AccessKeyId"],
        secret_key=cognito_creds["SecretAccessKey"],
        token=cognito_creds["SessionToken"],
    )

    request = AWSRequest(
        method="GET",
        url=HTTPS_URL,
        headers={"host": f"bedrock-agentcore.{REGION}.amazonaws.com"},
    )
    SigV4QueryAuth(creds, "bedrock-agentcore", REGION, expires=300).add_auth(request)

    # Convert back to wss:// for the WebSocket client
    return request.url.replace("https://", "wss://")

async def test():
    print("Getting Cognito credentials...")
    cognito_creds = get_cognito_credentials()

    print("\nSigning URL with Cognito creds...")
    url = get_presigned_url(cognito_creds)
    print(f"URL (first 120): {url[:120]}...")

    # Attempt the WebSocket connection — a 403 here means IAM policy issue, not signing
    print("\nConnecting via WebSocket...")
    try:
        async with websockets.connect(url, open_timeout=60) as ws:
            print("WebSocket connected! (Cognito creds work)")
            await ws.close()
    except websockets.exceptions.InvalidStatus as e:
        print(f"WS failed: HTTP {e.response.status_code}")
        print(f"Body: {e.response.body.decode(errors='replace')}")
    except Exception as e:
        print(f"WS failed: {type(e).__name__}: {e}")

if __name__ == "__main__":
    asyncio.run(test())