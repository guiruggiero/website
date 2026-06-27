# Imports
import asyncio
import functools
import logging
import os
import re
import smtplib
import traceback
from datetime import datetime
from email.message import EmailMessage
from zoneinfo import ZoneInfo
from fastapi import WebSocket, WebSocketDisconnect
from langfuse import Langfuse
from strands import tool
from strands.experimental.bidi.agent import BidiAgent
from strands.experimental.bidi.models import BidiNovaSonicModel
from strands_tools import stop

# Initializations
logger = logging.getLogger(__name__)
MODEL_ID = "amazon.nova-2-sonic-v1:0"
REGION = "us-west-2"
INPUT_SAMPLE_RATE = 16000
OUTPUT_SAMPLE_RATE = 16000
LANGFUSE_PROMPT_NAME = "GuiPT-Sonic"
_langfuse: Langfuse | None = None
PST = ZoneInfo("America/Los_Angeles")
_EMAIL_REGEX = re.compile(r"^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$")
MAX_EMAILS_PER_SESSION = 2

# Tool registrations via  Strands with docstrings as tool descriptions
@tool
def get_date_and_time() -> dict:
    """Get the current date and time in PST timezone. Use when the user asks what day, date, or time it is."""
    now = datetime.now(PST)
    return {
        "formattedTime": now.strftime("%I:%M %p"),
        "date": now.strftime("%Y-%m-%d"),
        "year": now.year,
        "month": now.month,
        "day": now.day,
        "dayOfWeek": now.strftime("%A"),
        "timezone": "PST",
    }

@tool
def send_email(first_name: str, last_name: str, sender_email: str, message: str, agent: BidiAgent) -> str:
    """Send an email to Gui on behalf of the user. Use when someone wants to send Gui a message.

    Args:
        first_name: The sender's first name.
        last_name: The sender's last name.
        sender_email: The sender's email address.
        message: The message body to send.
    """
    # Per-session rate limit
    if not hasattr(agent, "_emails_sent"):
        agent._emails_sent = 0
    if agent._emails_sent >= MAX_EMAILS_PER_SESSION:
        return "Email limit reached for this session."

    # Gmail SMTP credentials from environment
    recipient = os.environ.get("EMAIL_GUI")
    gmail_sender = os.environ.get("GMAIL_SENDER")
    gmail_password = os.environ.get("GMAIL_APP_PASSWORD")
    if not all([recipient, gmail_sender, gmail_password]):
        return "Email service is not configured."

    # Build the email
    full_name = f"{first_name} {last_name}"
    email = EmailMessage()
    email["From"] = f"GuiPT Sonic <{gmail_sender}>"
    email["To"] = recipient
    email["Subject"] = f"Message from {full_name}"
    if _EMAIL_REGEX.match(sender_email):  # only set Reply-To if valid email
        email["Reply-To"] = f"{full_name} <{sender_email}>"

    email.set_content(
        f"<p>{message}</p><hr><p><strong>From:</strong> {full_name} &lt;{sender_email}&gt;</p>",
        subtype="html",
    )

    # Send via Gmail SMTP
    try:
        with smtplib.SMTP_SSL("smtp.gmail.com", 465) as server:
            server.login(gmail_sender, gmail_password)
            server.send_message(email)
        agent._emails_sent += 1
        return f"Email sent successfully to Gui from {full_name}."
    except Exception as e:
        logger.error("Failed to send email: %s", e)
        return "Sorry, there was an error sending the email. Please try again."

def init_langfuse():
    # Initialize the Langfuse client and warm the prompt cache at server startup
    global _langfuse
    _langfuse = Langfuse(
        secret_key=os.environ["LANGFUSE_SECRET_KEY"],
        public_key=os.environ["LANGFUSE_PUBLIC_KEY"],
        base_url="https://us.cloud.langfuse.com",
    )
    prompt = _langfuse.get_prompt(LANGFUSE_PROMPT_NAME, cache_ttl_seconds=600)
    logger.info("Langfuse initialized, prompt cached (v%s)", prompt.version)

# Read incoming messages and forward non-config events to the agent
async def _handle_websocket_input(websocket: WebSocket, agent, agent_ready: asyncio.Event):
    agent_ready.set()  # first call means agent.run() is initialized and ready
    while True:
        message = await websocket.receive_json()

        if message.get("type") == "config":
            # Config can only be set once, reject re-configuration mid-session
            await websocket.send_json({
                "type": "system",
                "message": "Configuration can only be set once per session. Reconnect to change settings.",
            })
            continue

        if message.get("type") == "text_input":
            text = message.get("text", "")
            logger.info("Text input received")
            await agent.send(text)
            continue

        # Non-config, non-text messages (e.g. bidi_audio_input) return to agent.run()
        return message

async def handle_websocket_session(websocket: WebSocket, send_output=None):
    output_fn = send_output or websocket.send_json

    logger.info("New WebSocket connection - waiting for config event")

    try:
        # Block until the client sends a valid config event
        config = await _wait_for_config(websocket)
        if config is None:
            return

        # Build and start the bidi agent
        logger.info("Agent initialized - starting session")
        await websocket.send_json({"type": "system", "message": "Configuration applied. Agent ready."})

        agent = _create_agent(config)

        agent_ready = asyncio.Event()
        ws_input = functools.partial(_handle_websocket_input, websocket, agent, agent_ready)

        # agent.run() manages start/stop internally, stop on exit even an exception
        try:
            run_task = asyncio.create_task(
                agent.run(inputs=[ws_input], outputs=[output_fn])
            )
            await agent_ready.wait()
            await agent.send("Hello")
            await run_task
            await output_fn({"type": "session_end"}) # signal clean stop before close
        finally:
            await agent.stop()

    except WebSocketDisconnect:
        logger.info("Client disconnected")
    except Exception as e:
        # Suppress noisy CRT cleanup errors from the AWS SDK on teardown
        if "InvalidStateError" in type(e).__name__ or "CANCELLED" in str(e):
            logger.warning("Ignoring CRT cleanup error")
        else:
            logger.error("Session error: %s", type(e).__name__)
            traceback.print_exc()
            try:
                await output_fn({"type": "error", "message": str(e)})
            except Exception:
                pass
    finally:
        logger.info("Connection closed")

# Wait for the first message and reject anything that isn't a config event
async def _wait_for_config(websocket: WebSocket) -> dict | None:
    while True:
        message = await websocket.receive_json()

        if message.get("type") == "config":
            config = {"voice": message.get("voice", "tiffany")}
            logger.info("Config received: voice=%s", config["voice"])
            return config

        # Reject any other message type and keep waiting
        logger.warning("Expected config event first, got: %s", message.get("type"))
        await websocket.send_json({"type": "system", "message": "Please send config event first"})

# Instantiate the Nova Sonic model and wrap it in a BidiAgent
def _create_agent(config: dict) -> BidiAgent:
    # Langfuse serves from local cache or fetches again
    prompt = _langfuse.get_prompt(LANGFUSE_PROMPT_NAME, cache_ttl_seconds=600)
    system_prompt = prompt.compile()
    logger.info("System prompt fetched (Langfuse v%s)", prompt.version)

    model = BidiNovaSonicModel(
        model_id=MODEL_ID,
        provider_config={"audio": {
            "input_rate": INPUT_SAMPLE_RATE,
            "output_rate": OUTPUT_SAMPLE_RATE,
            "voice": config["voice"],
        }},
        client_config={"region": REGION},
    )

    return BidiAgent(
        model=model,
        system_prompt=system_prompt,
        tools=[stop, get_date_and_time, send_email],
        # messages=[], # Conversation history
    )