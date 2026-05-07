# Imports
import logging
import uvicorn
import os
import json
import asyncio
import requests
from contextlib import asynccontextmanager
from datetime import datetime
from fastapi import FastAPI, WebSocket
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from agent import handle_websocket_session, init_langfuse

# Initializations
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)
MAX_WS_MESSAGE_SIZE = 10000 # AgentCore's WebSocket proxy 10 KB frame limit

# Split a large event dict into multiple chunks that each fit under the frame size limit
def split_large_event(event_dict, max_size=MAX_WS_MESSAGE_SIZE):
    event_json = json.dumps(event_dict)
    if len(event_json.encode("utf-8")) <= max_size:
        return [event_dict]

    # Only audio events can be split — return others as-is even if oversized
    if "audio" not in event_dict or not isinstance(event_dict["audio"], str):
        return [event_dict]

    # Calculate max base64 chunk size that leaves room for the rest of the fields
    audio_content = event_dict["audio"]
    template = {k: v for k, v in event_dict.items() if k != "audio"}
    template["audio"] = ""
    overhead = len(json.dumps(template).encode("utf-8"))
    max_chunk = ((max_size - overhead - 100) // 4) * 4  # Keep aligned to base64 block boundary

    if max_chunk <= 0:
        return [event_dict]

    # Slice the audio string into chunks and re-pad each piece to valid base64
    chunks = []
    for i in range(0, len(audio_content), max_chunk):
        piece = audio_content[i : i + max_chunk]
        rem = len(piece) % 4
        if rem:
            piece += "=" * (4 - rem)
        chunk = {k: v for k, v in event_dict.items() if k != "audio"}
        chunk["audio"] = piece
        chunks.append(chunk)

    return chunks

# Background task handle — kept at module level so startup/shutdown can cancel it
_credential_refresh_task = None

# Fetch the IMDSv2 session token needed to authenticate metadata requests
def _get_imdsv2_token():
    try:
        r = requests.put(
            "http://169.254.169.254/latest/api/token",
            headers={"X-aws-ec2-metadata-token-ttl-seconds": "21600"},
            timeout=2,
        )
        if r.status_code == 200:
            return r.text
    except Exception:
        pass
    return None

# Retrieve temporary AWS credentials from the EC2 instance metadata service
def _get_credentials_from_imds():
    try:
        token = _get_imdsv2_token()
        headers = {"X-aws-ec2-metadata-token": token} if token else {}

        # Get the IAM role name attached to this instance
        role_r = requests.get(
            "http://169.254.169.254/latest/meta-data/iam/security-credentials/",
            headers=headers,
            timeout=2,
        )
        if role_r.status_code != 200:
            return None
        role_name = role_r.text.strip()

        # Fetch the actual credentials for that role
        creds_r = requests.get(
            f"http://169.254.169.254/latest/meta-data/iam/security-credentials/{role_name}",
            headers=headers,
            timeout=2,
        )
        if creds_r.status_code != 200:
            return None

        c = creds_r.json()
        return {
            "AccessKeyId": c.get("AccessKeyId"),
            "SecretAccessKey": c.get("SecretAccessKey"),
            "Token": c.get("Token"),
            "Expiration": c.get("Expiration"),
        }
    except Exception:
        return None

# Refresh AWS credentials from IMDS before they expire, then sleep until the next refresh window
async def _refresh_credentials_loop():
    logger.info("IMDS credential refresh task started")
    while True:
        try:
            creds = _get_credentials_from_imds()
            if creds:
                # Write credentials into the environment so boto3 picks them up automatically
                os.environ["AWS_ACCESS_KEY_ID"] = creds["AccessKeyId"]
                os.environ["AWS_SECRET_ACCESS_KEY"] = creds["SecretAccessKey"]
                os.environ["AWS_SESSION_TOKEN"] = creds["Token"]
                logger.info("Credentials refreshed from IMDS")

                # Sleep until 5 minutes before expiry, clamped between 1 and 60 minutes
                try:
                    exp = datetime.fromisoformat(creds["Expiration"].replace("Z", "+00:00"))
                    secs = (exp - datetime.now(exp.tzinfo)).total_seconds()
                    interval = min(max(secs - 300, 60), 3600)
                except Exception:
                    interval = 3600
                await asyncio.sleep(interval)
            else:
                logger.warning("IMDS credential fetch failed, retrying in 5 min")
                await asyncio.sleep(300)
        except asyncio.CancelledError:
            raise
        except Exception as e:
            logger.error("Credential refresh error: %s", e)
            await asyncio.sleep(300)

@asynccontextmanager
async def lifespan(app: FastAPI):
    global _credential_refresh_task

    # Prefer explicit env var credentials (local dev) over IMDS (AgentCore container)
    if os.getenv("AWS_ACCESS_KEY_ID") and os.getenv("AWS_SECRET_ACCESS_KEY"):
        logger.info("Using AWS credentials from environment")
    else:
        logger.info("Fetching credentials from IMDS...")
        creds = _get_credentials_from_imds()
        if creds:
            os.environ["AWS_ACCESS_KEY_ID"] = creds["AccessKeyId"]
            os.environ["AWS_SECRET_ACCESS_KEY"] = creds["SecretAccessKey"]
            os.environ["AWS_SESSION_TOKEN"] = creds["Token"]
            logger.info("IMDS credentials loaded")
            _credential_refresh_task = asyncio.create_task(_refresh_credentials_loop())
        else:
            logger.warning("IMDS unavailable — proceeding without explicit credentials")

    init_langfuse()

    yield

    # Cancel the background refresh loop cleanly on shutdown
    if _credential_refresh_task and not _credential_refresh_task.done():
        _credential_refresh_task.cancel()
        try:
            await _credential_refresh_task
        except asyncio.CancelledError:
            pass

app = FastAPI(title="Minimal Nova Sonic Agent", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/ping")
async def ping():
    # AgentCore health check — must return this exact shape
    import time
    return JSONResponse({"status": "Healthy", "time_of_last_update": int(time.time())})

@app.post("/invocations")
async def invocations():
    # Required by AgentCore protocol. This agent is WebSocket-only
    return JSONResponse({
        "message": "This agent uses WebSocket bidirectional streaming.",
        "websocket_endpoint": "/ws",
    })

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()

    # Wrap send_json to transparently split oversized audio frames
    async def chunked_send_json(event_dict):
        for chunk in split_large_event(event_dict):
            await websocket.send_json(chunk)

    await handle_websocket_session(websocket, send_output=chunked_send_json)

if __name__ == "__main__":
    host = os.getenv("HOST", "0.0.0.0")
    port = int(os.getenv("PORT", "8080"))
    uvicorn.run(app, host=host, port=port)