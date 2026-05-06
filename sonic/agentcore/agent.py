# Imports
import asyncio
import functools
import logging
import traceback
from fastapi import WebSocket, WebSocketDisconnect
from strands.experimental.bidi.agent import BidiAgent
from strands.experimental.bidi.models import BidiNovaSonicModel
from strands.experimental.bidi.tools import stop_conversation

# Initializations
logger = logging.getLogger(__name__)
MODEL_ID = "amazon.nova-2-sonic-v1:0"
REGION = "us-west-2"
INPUT_SAMPLE_RATE = 16000
OUTPUT_SAMPLE_RATE = 16000
SYSTEM_PROMPT = (
    "You are a friendly companion having a casual chat. "
    "Be warm, conversational, and natural. Keep responses concise and engaging."
)

# Read incoming messages and forward non-config events to the agent
async def _handle_websocket_input(websocket: WebSocket, agent, agent_ready: asyncio.Event):
    agent_ready.set()  # first call means agent.run() is initialized and ready
    while True:
        message = await websocket.receive_json()

        if message.get("type") == "config":
            # Config can only be set once — reject re-configuration mid-session
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

    logger.info("New WebSocket connection — waiting for config event")

    try:
        # Block until the client sends a valid config event
        config = await _wait_for_config(websocket)
        if config is None:
            return

        # Build and start the bidi agent
        logger.info("Agent initialized — starting session")
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
            await agent.send("Hi, who are you? Answer in 10 words or less")
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
        system_prompt=SYSTEM_PROMPT,
        tools=[stop_conversation],
    )