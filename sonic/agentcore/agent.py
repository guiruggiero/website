# Imports
import asyncio
import base64
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
from strands import ToolContext, tool
from strands.bidi.agent import BidiAgent
from strands.bidi.models import BedrockNovaSonicModel
from strands.bidi.types.media import AudioDelta

# Initializations
logger = logging.getLogger(__name__)
MODEL_ID = "amazon.nova-2-5-sonic"
REGION = "us-west-2"
INPUT_SAMPLE_RATE = 16000
OUTPUT_SAMPLE_RATE = 24000
LANGFUSE_PROMPT_NAME = "GuiPT-Sonic"
_langfuse: Langfuse | None = None
PST = ZoneInfo("America/Los_Angeles")
_EMAIL_REGEX = re.compile(r"^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$")
MAX_EMAILS_PER_SESSION = 2
DEFAULT_FIRST_MESSAGE = "Hello"
MAX_FIRST_MESSAGE_LENGTH = 1000

# Tool registrations via  Strands with docstrings as tool descriptions
@tool(context=True)
def stop(tool_context: ToolContext[BidiAgent]) -> str:
    """End the conversation. Use when the user says or types "stop", says goodbye, or asks to end the conversation."""
    # BidiAgent has no stop_event_loop flag, cancel() is what ends run() - once this tool group completes
    tool_context.agent.cancel()
    return "Ending the conversation."

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

@tool(context=True)
def send_email(first_name: str, last_name: str, sender_email: str, message: str, tool_context: ToolContext[BidiAgent]) -> str:
    """Send an email to Gui on behalf of the user. Use when someone wants to send Gui a message.

    Args:
        first_name: The sender's first name.
        last_name: The sender's last name.
        sender_email: The sender's email address.
        message: The message body to send.
    """
    # Per-session rate limit, counted in the invocation state shared across the whole run
    state = tool_context.invocation_state
    if state.get("emails_sent", 0) >= MAX_EMAILS_PER_SESSION:
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
        state["emails_sent"] = state.get("emails_sent", 0) + 1
        return f"Email sent successfully to Gui from {full_name}."
    except Exception as e:
        logger.exception("Failed to send email: %s", e)
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

# Strands events the browser consumes; everything else (deltas, usage, tool blocks, etc.) stays server-side
CLIENT_EVENT_TYPES = frozenset({
    "bidi_connection_start",
    "bidi_audio_delta",
    "bidi_transcript_delta",
    "bidi_transcript_block",
    "bidi_barge_in",
    "bidi_response_stop",
})

# Read incoming messages and forward non-config events to the agent
async def _handle_websocket_input(websocket: WebSocket, agent):
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

        # Mic audio returns to agent.run() as an AudioDelta; sample rate comes from the model's audio config
        if message.get("type") == "bidi_audio_input":
            return AudioDelta(format="pcm", source={"bytes": base64.b64decode(message["audio"])})

        logger.warning("Ignoring unknown message type: %s", message.get("type"))

# Input stream for agent.run(); start() fires once the connection is live, so the first turn goes out from there
class _WebSocketInput:
    def __init__(self, websocket: WebSocket, first_message: str):
        self._websocket = websocket
        self._agent = None
        self._first_message = first_message

    async def start(self, agent):
        self._agent = agent
        await agent.send(self._first_message)

    async def stop(self):
        # Intentionally empty: required by the input stream interface, but nothing to clean up
        pass

    def __call__(self):
        return _handle_websocket_input(self._websocket, self._agent)

async def handle_websocket_session(websocket: WebSocket, send_output=None):
    send_fn = send_output or websocket.send_json

    # Only allowlisted Strands events reach the browser; our own frames go straight through send_fn
    async def output_fn(event):
        if event.get("type") in CLIENT_EVENT_TYPES:
            await send_fn(event)

    logger.info("New WebSocket connection - waiting for config event")

    try:
        # Block until the client sends a valid config event
        config = await _wait_for_config(websocket)
        if config is None:
            return

        # Build and start the bidi agent
        logger.info("Agent initialized - starting session")
        await websocket.send_json({"type": "system", "message": "Configuration applied, agent ready"})

        agent = _create_agent(config)

        ws_input = _WebSocketInput(websocket, config["first_message"])

        # Relay Nova Sonic's session ID to the client once the model captures it
        async def _send_session_id():
            await agent.model.session_id_ready.wait()
            await send_fn({"type": "system", "message": f"Session ID: {agent.model.session_id}"})

        # agent.run() manages start/stop internally, stop on exit even an exception
        session_id_task = asyncio.create_task(_send_session_id())
        try:
            await agent.run(inputs=[ws_input], outputs=[output_fn], invocation_state={"emails_sent": 0})
            await send_fn({"type": "session_end"}) # signal clean stop before close
        finally:
            session_id_task.cancel()

    except WebSocketDisconnect:
        logger.info("Client disconnected")
    except Exception as e:
        # Suppress noisy CRT cleanup errors from the AWS SDK on teardown
        if "InvalidStateError" in type(e).__name__ or "CANCELLED" in str(e):
            logger.warning("Ignoring CRT cleanup error")
        else:
            logger.exception("Session error: %s", type(e).__name__)
            traceback.print_exc()
            try:
                await send_fn({"type": "error", "message": str(e)})
            except Exception:
                pass
    finally:
        logger.info("Connection closed")

# Wait for the first message and reject anything that isn't a config event
async def _wait_for_config(websocket: WebSocket) -> dict | None:
    while True:
        message = await websocket.receive_json()

        if message.get("type") == "config":
            config = {
                "voice": message.get("voice", "tiffany"),
                "first_message": _clean_first_message(message.get("firstMessage")),
            }
            logger.info("Config received: voice=%s, custom first message=%s", config["voice"], config["first_message"] != DEFAULT_FIRST_MESSAGE)
            return config

        # Reject any other message type and keep waiting
        logger.warning("Expected config event first, got: %s", message.get("type"))
        await websocket.send_json({"type": "system", "message": "Please send config event first"})

# First turn the agent answers: the visitor's question (pill or typed) or a greeting in the page's language, from the client
def _clean_first_message(raw) -> str:
    if not isinstance(raw, str) or not raw.strip():
        return DEFAULT_FIRST_MESSAGE
    return raw.strip()[:MAX_FIRST_MESSAGE_LENGTH]

# Nova Sonic model subclass that captures its own session ID; Strands doesn't surface it publicly
class _SessionIdCapturingNovaSonicModel(BedrockNovaSonicModel):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.session_id = None
        self.session_id_ready = asyncio.Event()

    def _convert_nova_event(self, nova_event, *args, **kwargs):
        if self.session_id is None:
            session_id = (nova_event.get("completionStart") or nova_event.get("usageEvent") or {}).get("sessionId")
            if session_id:
                self.session_id = session_id
                self.session_id_ready.set()
        return super()._convert_nova_event(nova_event, *args, **kwargs)

# Instantiate the Nova Sonic model and wrap it in a BidiAgent
def _create_agent(config: dict) -> BidiAgent:
    # Langfuse serves from local cache or fetches again
    prompt = _langfuse.get_prompt(LANGFUSE_PROMPT_NAME, cache_ttl_seconds=600)
    system_prompt = prompt.compile()
    logger.info("System prompt fetched (Langfuse v%s)", prompt.version)

    model = _SessionIdCapturingNovaSonicModel(
        model_id=MODEL_ID,
        region=REGION,
        voice=config["voice"],
        audio={
            "input": {"sample_rate": INPUT_SAMPLE_RATE},
            "output": {"sample_rate": OUTPUT_SAMPLE_RATE},
        },
    )

    return BidiAgent(
        model=model,
        system_prompt=system_prompt,
        tools=[stop, get_date_and_time, send_email],
        # messages=[], # Conversation history
    )