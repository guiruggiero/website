#!/usr/bin/env python3
"""
Quick test: generate a SigV4-presigned WebSocket URL for the AgentCore runtime
and attempt to connect. Run from 03-minimal-sonic/ with AWS credentials set.
"""
import asyncio
import boto3
from botocore.auth import SigV4QueryAuth
from botocore.awsrequest import AWSRequest
import websockets

REGION = "us-west-2"
# Full URL as printed by deploy/deploy.py (ARN URL-encoded)
WSS_BASE = "wss://bedrock-agentcore.us-west-2.amazonaws.com/runtimes/arn%3Aaws%3Abedrock-agentcore%3Aus-west-2%3A250711740447%3Aruntime%2Fminimal_sonic_agent-XNEC1PGRQK/ws"
HTTPS_URL = WSS_BASE.replace("wss://", "https://") + "?qualifier=DEFAULT"

def get_presigned_url():
    session = boto3.Session()
    creds = session.get_credentials().get_frozen_credentials()

    request = AWSRequest(
        method="GET",
        url=HTTPS_URL,
        headers={"host": f"bedrock-agentcore.{REGION}.amazonaws.com"},
    )
    SigV4QueryAuth(creds, "bedrock-agentcore", REGION, expires=300).add_auth(request)

    return request.url.replace("https://", "wss://")

async def test():
    url = get_presigned_url()
    print(f"Presigned URL (first 120): {url[:120]}...")
    print(f"\nFull URL for browser test:\n{url}\n")

    # First probe with a plain HTTPS GET to see the raw server response
    import urllib.request
    https_url = url.replace("wss://", "https://")
    try:
        resp = urllib.request.urlopen(https_url, timeout=10)
        print(f"HTTPS {resp.status}: {resp.read(200)}")
    except urllib.error.HTTPError as e:
        print(f"HTTPS {e.code}: {e.read(200).decode(errors='replace')}")
    except Exception as e:
        print(f"HTTPS probe failed: {e}")

    # Then try WebSocket
    try:
        async with websockets.connect(url, open_timeout=60) as ws:
            print("WebSocket connected!")
            await ws.close()
    except websockets.exceptions.InvalidStatus as e:
        print(f"WS failed: HTTP {e.response.status_code}")
        print(f"Body: {e.response.body.decode(errors='replace')}")
    except Exception as e:
        print(f"WS failed: {type(e).__name__}: {e}")

if __name__ == "__main__":
    asyncio.run(test())
