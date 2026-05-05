# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this folder.

## Setup

```bash
python -m venv .venv
source .venv/bin/activate   # Linux
.venv-win\Scripts\activate  # Windows PowerShell
python -m pip install -r requirements.txt --force-reinstall
```

AWS credentials must be set as environment variables before running any script:
```bash
export AWS_ACCESS_KEY_ID="..."
export AWS_SECRET_ACCESS_KEY="..."
export AWS_DEFAULT_REGION="us-west-2"
```

**Important:** Use a headset — PyAudio's echo handling causes unexpected barge-in interruptions when using open speakers.

## Running the scripts

Activate the virtual environment first if not already active:
```bash
source .venv/bin/activate   # Linux
.venv-win\Scripts\activate  # Windows PowerShell
```

```bash
python nova_sonic_simple.py     # basic, no barge-in
python nova_sonic.py            # bidirectional + barge-in
python nova_sonic_tool_use.py   # bidirectional + tool use
python nova_sonic_with_text.py  # text/audio/mixed modes

python nova_sonic.py --debug                 # verbose timestamped logging
python nova_sonic_with_text.py --mode text   # text-only
python nova_sonic_with_text.py --mode audio  # audio-only
python nova_sonic_with_text.py --mode mixed  # audio + text overlay
```

Press **Enter** at any time to end the session.

## Architecture

All scripts share the same two-class pattern:

**`BedrockStreamManager`** — owns the Bedrock connection and the event protocol.
- Calls `InvokeModelWithBidirectionalStream` from `aws_sdk_bedrock_runtime`
- Sends a strict event sequence on startup: `sessionStart → promptStart → contentStart (SYSTEM text) → contentEnd`
- Then opens an audio content block (`contentStart` with `type: AUDIO`) before streaming mic data
- Each audio chunk is base64-encoded LPCM (16 kHz, 16-bit, mono) and wrapped in `audioInput` events
- Receives `audioOutput` events (base64 LPCM, 24 kHz) and pushes them to `audio_output_queue`
- Detects barge-in by watching for `{ "interrupted" : true }` in `textOutput` content
- Displays assistant text only when `additionalModelFields.generationStage == "SPECULATIVE"`
- Session teardown: `contentEnd → promptEnd → sessionEnd → input_stream.close()`

**`AudioStreamer`** — owns PyAudio, bridges the async event loop and the PyAudio callback thread.
- Opens a callback-based input stream (16 kHz) and a blocking output stream (24 kHz)
- The PyAudio callback uses `asyncio.run_coroutine_threadsafe` to hand audio into the async event loop
- `play_output_audio()` drains `audio_output_queue` in `CHUNK_SIZE` blocks via `run_in_executor` to avoid blocking

**Key differences between scripts:**

| Script | Event dispatch | Audio input queue | Tool use | Text input |
|---|---|---|---|---|
| `nova_sonic_simple.py` | sequential, no barge-in | direct call | — | — |
| `nova_sonic.py` | RxPy `Subject` + `AsyncIOScheduler` | RxPy `audio_subject` | — | — |
| `nova_sonic_tool_use.py` | `asyncio.Queue` + `_process_audio_input` task | `asyncio.Queue` | `getDateAndTimeTool`, `trackOrderTool` | — |
| `nova_sonic_with_text.py` | RxPy (same as `nova_sonic.py`) | RxPy `audio_subject` | `getDateAndTimeTool` | `TextInputHandler`, `SilentAudioStreamer`, `MixedModeHandler` |

**Tool use flow** (`nova_sonic_tool_use.py` / `nova_sonic_with_text.py`):
1. Model sends a `toolUse` event → captured in `self.toolName` / `self.toolUseContent` / `self.toolUseId`
2. When `contentEnd` with `type: TOOL` arrives → `handle_tool_request()` fires an async task
3. Task runs `ToolProcessor._run_tool()` then sends `contentStart (TOOL) → toolResult → contentEnd`

**`nova_sonic_with_text.py` additions:**
- `SilentAudioStreamer` — subclass that sends zeroed-out PCM chunks instead of mic data, keeping the audio content block alive for text-only mode
- `TextInputHandler` — reads `stdin` via `run_in_executor`, sends text turns using `send_text_with_new_content_name()` (each message gets a fresh UUID content name)
- `MixedModeHandler` — combines a real mic input stream with a concurrent `handle_text_input()` coroutine

## Customization points

- **System prompt**: `default_system_prompt` in `initialize_stream()`
- **Voice**: `voiceId` in the `promptStart` event (default: `"matthew"`)
- **Audio chunk size**: `CHUNK_SIZE` constant (512 in `nova_sonic.py`, 1024 in others)
- **Inference params**: `maxTokens`, `topP`, `temperature` in `START_SESSION_EVENT`
- **Adding tools**: extend `toolConfiguration.tools` in `start_prompt()` and add a branch in `ToolProcessor._run_tool()`
