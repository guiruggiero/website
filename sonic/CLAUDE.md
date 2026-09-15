# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

No automated tests or linters are configured. `scripts/test_ws.py` and `scripts/test_cognito_ws.py` are manual connection checks, run by hand.

`README.md` owns setup: prerequisites, venv and `.env` layout, the four-step deploy-and-test walkthrough, cleanup, and a per-file table. This file covers architecture and the constraints that aren't obvious from the code - don't duplicate the README here.

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
| server → client | `bidi_interruption` | - stops playback |
| server → client | `bidi_response_complete` | - |
| server → client | `session_end` | - agent-initiated end of conversation (triggers `endSession()`) |
| server → client | `system` / `error` | `message` |

The `voice` sent in `config` comes from the `VOICE_ID` constant in `sonic.js`'s init block (`"tiffany"`, with `"carolina"` kept commented as the alternative).

### Tools

`agent.py` registers three tools (`tools=[stop, get_date_and_time, send_email]`):

| Tool | Behavior |
|---|---|
| `stop` | Ends the conversation agent-side - this is what emits the `session_end` frame in the table above |
| `get_date_and_time` | Current date and time, so the agent can reason about "today" |
| `send_email` | Emails Gui on the user's behalf |

`send_email` specifics worth knowing before touching it:

- Sends via Gmail SMTP over SSL (`smtplib.SMTP_SSL("smtp.gmail.com", 465)`), not SES - so it needs a Gmail app password, not AWS credentials
- Capped at `MAX_EMAILS_PER_SESSION = 2`, tracked on an `agent._emails_sent` counter attached lazily to the agent instance
- Sets `Reply-To` only when the caller-supplied address matches `_EMAIL_REGEX`; an invalid address still sends, just with no reply path
- Reads `EMAIL_GUI` (recipient), `GMAIL_SENDER`, and `GMAIL_APP_PASSWORD` from the container environment

### Key implementation constraints

- **10 KB WebSocket frame limit**: AgentCore's proxy enforces this. `server.py:split_large_event()` splits large `bidi_audio_stream` payloads into chunks before sending - do not bypass this.
- **IMDS credential refresh**: On AgentCore the container gets credentials from EC2 IMDS. `server.py` polls IMDS on startup and refreshes before expiry. Locally, env vars take precedence (`AWS_ACCESS_KEY_ID` etc.).
- **Docker image must be `linux/arm64`**: AgentCore runs on ARM. `deploy.py` passes `--platform linux/arm64` to `docker buildx build`. The Dockerfile uses `ARG TARGETPLATFORM` so the base image inherits the platform from buildx.
- **AgentCore required endpoints**: `/ping` must return `{"status": "Healthy", "time_of_last_update": <unix_ts>}` and `/invocations` must exist (HTTP POST), even though this agent is WebSocket-only.
- **SigV4 URL signing**: `buildSignedUrl` in `sonic.js` passes `decodeURIComponent(rawPath)` to the Smithy signer, then uses `signed.path` (not `rawPath`) to build the final WebSocket URL. The two must match or AgentCore returns 403. Using `rawPath` in the final URL causes a mismatch because Smithy normalises `%2F` → `/` in the canonical URI.
- **Browser dependencies load from a CDN at runtime**: `@smithy/signature-v4`, `@aws-crypto/sha256-browser`, `@aws-sdk/client-cognito-identity` and `@aws-sdk/client-sts` are top-level dynamic `import()`s from jsdelivr at the head of `sonic.js` - there's no bundler and no lockfile pinning them, so an upstream or CDN change lands without a deploy on this side.
- **`?wsUrl=` is sanitized deliberately**: `sanitizeLocalWsUrl` returns a URL only when `isDev` is true (hostname is `localhost` or the hardcoded ngrok host) *and* the value parses as `ws:` on `localhost`/`127.0.0.1`. This exists to prevent connection hijacking via a crafted link - don't loosen it to accept `wss:` or arbitrary hosts for convenience.
- **Cognito role IAM policy**: The Cognito unauthenticated role needs `bedrock-agentcore:InvokeAgentRuntimeWithWebSocketStream` on `arn:aws:bedrock-agentcore:REGION:ACCOUNT:runtime/RUNTIME_ID*` (trailing `*` required - AgentCore evaluates the resource as both the bare ARN and `ARN/runtime-endpoint/DEFAULT` depending on the request phase). To debug the exact resource ARN in a 403, run `scripts/test_cognito_ws.py` with a deliberately wrong policy - the error body prints the full ARN. This does not work from the browser due to CORS.

### Client audio pipeline

Mic → `AudioWorkletNode` (`mic-processor.js`, 4096-sample buffer) → downsample to 16 kHz → Int16 PCM → base64 → `bidi_audio_input` frames.

Received `bidi_audio_stream` audio is decoded from base64 → Int16 → Float32 and queued into a `AudioContext` buffer chain (`nextPlayTime`) to play gaplessly. On `bidi_interruption`, playback is stopped (with a short drain window of up to 300 ms if audio is already buffered).

### Eager pre-loading

On page load (before the user clicks Start), `sonic.js` kicks off non-blocking tasks in the background:

1. **Credentials** - `ensureCredentials()` fetches Cognito temp credentials via `_credentialPromise`.
2. **Signed URL** - `ensureSignedUrl()` chains off credentials to pre-build the SigV4 WebSocket URL via `_signedUrlPromise`.
3. **WebSocket** - `ensureWebSocket()` chains off the signed URL (or `localWsUrl` override) to open and hold an idle connection via `_wsPromise`, so the connect round-trip and AgentCore container boot happen before the click instead of during it. The server just waits for `config` - no agent or model work happens on this pre-warmed connection until the user actually starts a session. `startSession()` reuses it if still `OPEN`, otherwise opens a fresh one as a fallback.
4. **AudioWorklet** - `_workletReady` promise creates a silent `AudioContext` and calls `audioWorklet.addModule("mic-processor.js")` so the worklet module is already compiled when `startMic()` runs.

When `startSession()` is called, mic setup and the WebSocket connection (pre-warmed or fresh) are raced in parallel (`Promise.all([micPromise, openPromise])`), then config is sent once both are ready.

### System prompt

The agent's system prompt is fetched from Langfuse (prompt name `GuiPT-Sonic`) rather than hardcoded. `init_langfuse()` is called during server startup to warm the cache. Each new session calls `get_prompt()` with a 600s cache TTL.

`deploy.py` reads `sonic/.env` and passes its contents as `environmentVariables` to the AgentCore runtime, so the container needs `LANGFUSE_SECRET_KEY` and `LANGFUSE_PUBLIC_KEY` for the prompt, plus `EMAIL_GUI`, `GMAIL_SENDER` and `GMAIL_APP_PASSWORD` for `send_email`.

**Editing the prompt**: `scripts/prompt_sync.py pull|push` syncs against `agentcore/prompt.md` (gitignored, exists so Claude Code has the full prompt in context). `pull` prints a diff against the local copy before overwriting it. **`push` does not go live** - it calls `create_prompt` with `labels=[]`, deliberately omitting `"production"`, so the new version sits in Langfuse until it's promoted there by hand. And since `pull` calls `get_prompt(PROMPT_NAME)` with no label, it fetches the production version - so pulling before promoting overwrites `prompt.md` with the old live prompt, losing the edits you just pushed. Same convention as `guipt`, `guimail` and `guido`, which all omit the label too - a push is never a deploy.

### Agent speaks first

After the server sends `"Configuration applied. Agent ready."`, `agent.py` waits for `agent.run()` to initialize (signalled by `agent_ready` event), then immediately calls `await agent.send("Hello")` so the agent speaks an opening greeting without waiting for user input.

### Nova Sonic session ID

Strands doesn't surface Nova Sonic's own session ID publicly, so `agent.py`'s `_SessionIdCapturingNovaSonicModel` overrides `_convert_nova_event` (a sync method) to peek at the raw `completionStart`/`usageEvent` payloads for `sessionId` and capture it once via `self.session_id` + an `asyncio.Event`. `handle_websocket_session` awaits that event in a background task and relays the ID to the client as a `system` message, so it shows up in the transcript like any other system message - no dedicated protocol type or `sonic.js` change needed. This is Nova Sonic's model-level session ID, unrelated to AgentCore's own `runtimeSessionId` header (which the browser can't set or read on a WebSocket handshake anyway).

### Session start TTFA measurement

`sonic.js` records `performance.now()` at session start and logs the elapsed time (as a "Session start TTFA" system message) when the first `bidi_audio_stream` frame arrives. This measures the time from clicking Start to the first audio byte arriving over the WebSocket - not full playback, and distinct from any future per-turn TTFA metric.

### Deploy artifacts and redeployment

`scripts/setup_config.json` is written by `deploy.py` and read by `cleanup.py`. It is not committed. The two values that must be manually pasted into `sonic.js` after deploy are `COGNITO_IDENTITY_POOL_ID` and `RUNTIME_WSS_BASE` - the only two `deploy.py` prints for that purpose.

`sonic.js` also hardcodes a third constant, `COGNITO_ROLE_ARN`, which `deploy.py` creates and logs but does *not* include in the paste list. If that role is ever deleted and recreated, the constant needs updating by hand.

`deploy.py` handles re-deploys gracefully: if the runtime already exists, it calls `update_agent_runtime` with the new image URI and env vars instead of failing. This means pushing a new Docker image + running `deploy.py` again is sufficient to update the running agent. Environment variables are loaded from `sonic/.env` (not committed).

### Planned refactor

`README.md`'s TODOs define the intended seams before this grows: `sonic.js` splits into `auth.js` (credentials + SigV4), `audio.js` (mic, playback, AudioContext pre-warm) and `tools.js`, with session orchestration folding into the main site's `main.js` as a second mode alongside text GuiPT. Domain modules land in `modules/sonic/` and the CSS in `styles/sonic.css`. Worth reading before adding code here, so it goes where the split expects it.
