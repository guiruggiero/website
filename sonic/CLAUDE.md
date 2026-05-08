# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

There are no automated tests or linters configured.

## Architecture

```
Browser (GitHub Pages)          AWS us-west-2
──────────────────────          ──────────────────────────────────
index.html                      Cognito Identity Pool (unauthenticated)
sonic.js        ──get creds──▶   → temp AWS credentials
                ──sign URL───▶  bedrock-agentcore SigV4
                ══WebSocket══▶  AgentCore Runtime
                                  agentcore/server.py (FastAPI)
                                  agentcore/agent.py  (BidiAgent)
                                    → Nova Sonic (amazon.nova-2-sonic-v1:0)
                                    → Langfuse (system prompt)
```

### WebSocket message protocol

The browser and server exchange JSON frames. **The first message from the client must be `type: "config"`**; the server rejects any other message until config is received. After that:

| Direction | type | Key fields |
|-----------|------|------------|
| client → server | `config` | `voice` |
| client → server | `bidi_audio_input` | `audio` (base64 PCM), `format`, `sample_rate`, `channels` |
| client → server | `text_input` | `text` |
| server → client | `bidi_audio_stream` | `audio` (base64 PCM) |
| server → client | `bidi_transcript_stream` | `text`, `role`, `is_final` |
| server → client | `bidi_interruption` | — stops playback |
| server → client | `bidi_response_complete` | — |
| server → client | `session_end` | — agent-initiated end of conversation (triggers `endSession()`) |
| server → client | `system` / `error` | `message` |

### Key implementation constraints

- **10 KB WebSocket frame limit**: AgentCore's proxy enforces this. `server.py:split_large_event()` splits large `bidi_audio_stream` payloads into chunks before sending — do not bypass this.
- **IMDS credential refresh**: On AgentCore the container gets credentials from EC2 IMDS. `server.py` polls IMDS on startup and refreshes before expiry. Locally, env vars take precedence (`AWS_ACCESS_KEY_ID` etc.).
- **Docker image must be `linux/arm64`**: AgentCore runs on ARM. `deploy.py` passes `--platform linux/arm64` to `docker buildx build`. The Dockerfile uses `ARG TARGETPLATFORM` so the base image inherits the platform from buildx.
- **AgentCore required endpoints**: `/ping` must return `{"status": "Healthy", "time_of_last_update": <unix_ts>}` and `/invocations` must exist (HTTP POST), even though this agent is WebSocket-only.
- **SigV4 URL signing**: `buildSignedUrl` in `sonic.js` passes `decodeURIComponent(rawPath)` to the Smithy signer, then uses `signed.path` (not `rawPath`) to build the final WebSocket URL. The two must match or AgentCore returns 403. Using `rawPath` in the final URL causes a mismatch because Smithy normalises `%2F` → `/` in the canonical URI.
- **Cognito role IAM policy**: The Cognito unauthenticated role needs `bedrock-agentcore:InvokeAgentRuntimeWithWebSocketStream` on `arn:aws:bedrock-agentcore:REGION:ACCOUNT:runtime/RUNTIME_ID*` (trailing `*` required — AgentCore evaluates the resource as both the bare ARN and `ARN/runtime-endpoint/DEFAULT` depending on the request phase). To debug the exact resource ARN in a 403, run `scripts/test_cognito_ws.py` with a deliberately wrong policy — the error body prints the full ARN. This does not work from the browser due to CORS.

### Client audio pipeline

Mic → `AudioWorkletNode` (`mic-processor.js`, 4096-sample buffer) → downsample to 16 kHz → Int16 PCM → base64 → `bidi_audio_input` frames.

Received `bidi_audio_stream` audio is decoded from base64 → Int16 → Float32 and queued into a `AudioContext` buffer chain (`nextPlayTime`) to play gaplessly. On `bidi_interruption`, playback is stopped (with a short drain window of up to 300 ms if audio is already buffered).

### Eager pre-loading

On page load (before the user clicks Start), `sonic.js` kicks off three non-blocking tasks in the background:
1. **Credentials** — `ensureCredentials()` fetches Cognito temp credentials via `_credentialPromise`.
2. **Signed URL** — `ensureSignedUrl()` chains off credentials to pre-build the SigV4 WebSocket URL via `_signedUrlPromise`.
3. **AudioWorklet** — `_workletReady` promise creates a silent `AudioContext` and calls `audioWorklet.addModule("mic-processor.js")` so the worklet module is already compiled when `startMic()` runs.

When `startSession()` is called, mic setup and the WebSocket connection are started in parallel (`Promise.all([micPromise, openPromise])`), then config is sent once both are ready.

### System prompt

The agent's system prompt is fetched from Langfuse (prompt name `GuiPT-Sonic`) rather than hardcoded. `init_langfuse()` is called during server startup to warm the cache. Each new session calls `get_prompt()` with a 600s cache TTL. The container requires `LANGFUSE_SECRET_KEY` and `LANGFUSE_PUBLIC_KEY` env vars — `deploy.py` reads these from `sonic/.env` and passes them as `environmentVariables` to the AgentCore runtime.

### Agent speaks first

After the server sends `"Configuration applied. Agent ready."`, `agent.py` waits for `agent.run()` to initialize (signalled by `agent_ready` event), then immediately calls `await agent.send("Hello")` so the agent speaks an opening greeting without waiting for user input.

### UPL measurement

`sonic.js` records `performance.now()` at session start and logs the elapsed time (as a "UPL" system message) when the first `bidi_audio_stream` frame arrives. This measures the user-perceived latency from clicking Start to hearing the agent's first audio.

### Deploy artifacts

`scripts/setup_config.json` is written by `deploy.py` and read by `cleanup.py`. It is not committed. The two values that must be manually pasted into `sonic.js` after deploy are `COGNITO_IDENTITY_POOL_ID` and `RUNTIME_WSS_BASE`.

### Redeployment

`deploy.py` handles re-deploys gracefully: if the runtime already exists, it calls `update_agent_runtime` with the new image URI and env vars instead of failing. This means pushing a new Docker image + running `deploy.py` again is sufficient to update the running agent. Environment variables (Langfuse keys) are loaded from `sonic/.env` (not committed).
