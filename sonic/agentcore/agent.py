import logging
import traceback

from fastapi import WebSocket, WebSocketDisconnect

from strands.experimental.bidi.agent import BidiAgent
from strands.experimental.bidi.models.nova_sonic import BidiNovaSonicModel

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Server-side agent config (client sends only voice preference)
# ---------------------------------------------------------------------------

MODEL_ID = "amazon.nova-2-sonic-v1:0"
REGION = "us-west-2"
INPUT_SAMPLE_RATE = 16000
OUTPUT_SAMPLE_RATE = 16000

# TODO: Pull from Langfuse
SYSTEM_PROMPT = (
    "You are a friendly companion having a casual chat. "
    "Be warm, conversational, and natural. Keep responses concise and engaging."
)

async def handle_websocket_session(websocket: WebSocket, send_output=None):
    output_fn = send_output or websocket.send_json

    logger.info("New WebSocket connection — waiting for config event")

    try:
        config = await _wait_for_config(websocket)
        if config is None:
            return

        agent = _create_agent(config)
        logger.info("Agent initialized — starting session")

        await websocket.send_json({"type": "system", "message": "Configuration applied. Agent ready."})

        async def handle_websocket_input():
            while True:
                message = await websocket.receive_json()

                if message.get("type") == "config":
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

                return message

        await agent.run(inputs=[handle_websocket_input], outputs=[output_fn])

    except WebSocketDisconnect:
        logger.info("Client disconnected")
    except Exception as e:
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

async def _wait_for_config(websocket: WebSocket) -> dict | None:
    while True:
        message = await websocket.receive_json()

        if message.get("type") == "config":
            config = {"voice": message.get("voice", "tiffany")}
            logger.info("Config received: voice=%s", config["voice"])
            return config

        logger.warning("Expected config event first, got: %s", message.get("type"))
        await websocket.send_json({"type": "system", "message": "Please send config event first"})

def _create_agent(config: dict) -> BidiAgent:
    model = BidiNovaSonicModel(
        region=REGION,
        model_id=MODEL_ID,
        provider_config={
            "audio": {
                "input_sample_rate": INPUT_SAMPLE_RATE,
                "output_sample_rate": OUTPUT_SAMPLE_RATE,
                "voice": config["voice"],
            }
        },
    )

    return BidiAgent(
        model=model,
        tools=[],
        system_prompt=SYSTEM_PROMPT,
    )
