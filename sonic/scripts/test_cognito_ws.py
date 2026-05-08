# Imports
import asyncio
import json
import boto3
from botocore.auth import SigV4QueryAuth
from botocore.awsrequest import AWSRequest
from botocore.credentials import Credentials
from urllib.parse import urlparse, unquote
import websockets

# Initializations
REGION = "us-west-2"
COGNITO_IDENTITY_POOL_ID = "us-west-2:c71bd164-55c9-4dba-9abd-fec92b8b5de4"
WSS_BASE = "wss://bedrock-agentcore.us-west-2.amazonaws.com/runtimes/arn%3Aaws%3Abedrock-agentcore%3Aus-west-2%3A250711740447%3Aruntime%2Fminimal_sonic_agent-XNEC1PGRQK/ws"
COGNITO_ROLE_ARN = "arn:aws:iam::250711740447:role/MinimalSonicCognitoRole"
VOICE_ID = "tiffany"

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

# Sign the AgentCore URL using Cognito temp credentials (mirrors sonic.js buildSignedUrl)
def get_presigned_url(cognito_creds):
    creds = Credentials(
        access_key=cognito_creds["AccessKeyId"],
        secret_key=cognito_creds["SecretAccessKey"],
        token=cognito_creds["SessionToken"],
    )

    # Decode the percent-encoded ARN path before signing (mirrors decodeURIComponent(rawPath) in sonic.js)
    parsed = urlparse(WSS_BASE.replace("wss://", "https://"))
    decoded_url = f"https://{parsed.netloc}{unquote(parsed.path)}?qualifier=DEFAULT"

    request = AWSRequest(
        method="GET",
        url=decoded_url,
        headers={"host": f"bedrock-agentcore.{REGION}.amazonaws.com"},
    )
    SigV4QueryAuth(creds, "bedrock-agentcore", REGION, expires=900).add_auth(request)

    # Convert back to wss://, request.url holds the path botocore signed over
    return request.url.replace("https://", "wss://")

async def recv_loop(ws):
    async for raw in ws:
        data = json.loads(raw)
        msg_type = data.get("type")
        if msg_type == "system":
            print(f"System: {data.get('message')}")
        elif msg_type == "bidi_audio_stream":
            print(f"Audio chunk ({len(data.get('audio', ''))} base64 chars)")
        elif msg_type == "bidi_transcript_stream":
            role = data.get("role", "?")
            suffix = "*" if data.get("is_final") else ""
            print(f"Transcript [{role}{suffix}]: {data.get('text', '')[:80]}")
        elif msg_type == "bidi_connection_start":
            print("Bidi session established - connection verified")
            return
        elif msg_type == "bidi_response_complete":
            print("Response complete - session verified")
            return
        elif msg_type == "session_end":
            print("Session ended by agent")
            return
        elif msg_type == "error":
            print(f"Error: {data.get('message')}")
            return
        else:
            print(f"Received: {msg_type}")

async def test():
    print("Getting Cognito credentials...")
    cognito_creds = get_cognito_credentials()

    print("\nSigning URL with Cognito creds...")
    url = get_presigned_url(cognito_creds)
    print(f"URL (first 120): {url[:120]}...")

    # Connect and run a full session: send config, receive the agent's opening greeting
    print("\nConnecting via WebSocket...")
    try:
        async with websockets.connect(url, open_timeout=60) as ws:
            print("WebSocket connected!")

            # Config must be the first message (server rejects anything else until received)
            await ws.send(json.dumps({"type": "config", "voice": VOICE_ID}))
            print(f"Sent config (voice: {VOICE_ID})")

            # Receive messages until the agent's opening response is complete or timeout
            try:
                await asyncio.wait_for(recv_loop(ws), timeout=30)
            except asyncio.TimeoutError:
                print("Timeout (30s), closing")

    except websockets.exceptions.InvalidStatus as e:
        print(f"WS failed: HTTP {e.response.status_code}")
        print(f"Body: {e.response.body.decode(errors='replace')}")
    except Exception as e:
        print(f"WS failed: {type(e).__name__}: {e}")

if __name__ == "__main__":
    asyncio.run(test())