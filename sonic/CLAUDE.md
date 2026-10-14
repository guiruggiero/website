# CLAUDE.md

No automated tests or linters are configured. `scripts/test_ws.py` and `scripts/test_cognito_ws.py` are manual connection checks, run by hand.

`README.md` owns setup: prerequisites, install and `.env` layout, the four-step deploy-and-test walkthrough, cleanup, a per-file table and the TODOs. This file covers architecture and the constraints that aren't obvious from the code - don't duplicate the README here.

## Architecture

```
Browser (GitHub Pages)          AWS us-west-2
──────────────────────          ──────────────────────────────────
sonic/index.html                Cognito Identity Pool (unauthenticated)
modules/sonic.js ─get creds──▶   → temp AWS credentials
                ──sign URL───▶  bedrock-agentcore SigV4
                ══WebSocket══▶  AgentCore Runtime
                                  agentcore/server.py (FastAPI)
                                  agentcore/agent.py  (BidiAgent)
                                    → Nova Sonic (amazon.nova-2-5-sonic)
                                    → Langfuse (system prompt)
```

### WebSocket message protocol

The browser and server exchange JSON frames. **The first message from the client must be `type: "config"`**; the server rejects any other message until config is received. After that:

| Direction | type | Key fields |
|-----------|------|------------|
| client → server | `config` | `voice`, `firstMessage` |
| client → server | `bidi_audio_input` | `audio` (base64 PCM), `format` |
| client → server | `text_input` | `text` |
| server → client | `bidi_connection_start` | `connection_id`, `model` |
| server → client | `bidi_audio_delta` | `audio` (base64 PCM) |
| server → client | `bidi_transcript_delta` | `delta`, `role` - agent text, one sentence at a time, ahead of its audio |
| server → client | `bidi_transcript_block` | `transcript`, `role` - the complete turn; the browser only uses the user's |
| server → client | `bidi_barge_in` | - stops playback |
| server → client | `bidi_response_stop` | - |
| server → client | `session_end` | - agent-initiated end of conversation (triggers `endSession()`) |
| server → client | `system` / `error` | `message` |

`config.voice` comes from the `VOICES` map in `sonic.js`, keyed by the page language `getLangData()` exposes as `lang`: `"tiffany"` for English (and the fallback), `"carolina"` for Portuguese. `config.firstMessage` is covered in [Agent speaks first](#agent-speaks-first).

### Tools

`agent.py` registers three local `@tool`s (`tools=[stop, get_date_and_time, send_email]`; `stop` and `send_email` use `context=True` / `ToolContext`):

| Tool | Behavior |
|---|---|
| `stop` | Calls `agent.cancel()` (`BidiAgent` has no `stop_event_loop` flag, so `cancel()` is what ends `run()`) - this is what leads to the `session_end` frame |
| `get_date_and_time` | Current date and time, so the agent can reason about "today" |
| `send_email` | Emails Gui on the user's behalf |

`send_email` specifics worth knowing before touching it:

- Sends via Gmail SMTP over SSL (`smtplib.SMTP_SSL("smtp.gmail.com", 465)`), not SES - so it needs a Gmail app password, not AWS credentials
- Capped at `MAX_EMAILS_PER_SESSION = 2`, tracked as `emails_sent` in the `invocation_state` dict passed to `agent.run()`, which tools read through `ToolContext.invocation_state`
- Sets `Reply-To` only when the caller-supplied address matches `_EMAIL_REGEX`; an invalid address still sends, just with no reply path
- Reads `EMAIL_GUI` (recipient), `GMAIL_SENDER`, and `GMAIL_APP_PASSWORD` from the container environment

### Key implementation constraints

- **10 KB WebSocket frame limit**: AgentCore's proxy enforces this. `server.py:split_large_event()` splits large `bidi_audio_delta` payloads into chunks before sending - do not bypass this.
- **IMDS credential refresh**: On AgentCore the container gets credentials from EC2 IMDS. `server.py` polls IMDS on startup and refreshes before expiry. Locally, env vars take precedence (`AWS_ACCESS_KEY_ID` etc.).
- **Docker image must be `linux/arm64`**: AgentCore runs on ARM. `deploy.py` passes `--platform linux/arm64` to `docker buildx build`. The Dockerfile uses `ARG TARGETPLATFORM` so the base image inherits the platform from buildx.
- **AgentCore required endpoints**: `/ping` must return `{"status": "Healthy", "time_of_last_update": <unix_ts>}` and `/invocations` must exist (HTTP POST), even though this agent is WebSocket-only.
- **SigV4 URL signing**: `buildSignedUrl` in `sonic.js` passes `decodeURIComponent(rawPath)` to the Smithy signer, then uses `signed.path` (not `rawPath`) to build the final WebSocket URL. The two must match or AgentCore returns 403 - Smithy normalises `%2F` → `/` in the canonical URI.
- **Browser dependencies load from a CDN at runtime**: `@smithy/signature-v4`, `@aws-crypto/sha256-browser`, `@aws-sdk/client-cognito-identity` and `@aws-sdk/client-sts` are top-level dynamic `import()`s from jsdelivr at the head of `sonic.js` - no bundler and no lockfile pinning them, so an upstream or CDN change lands without a deploy on this side.
- **`?wsUrl=` is sanitized deliberately**: `sanitizeLocalWsUrl` returns a URL only when `isDev` is true (hostname is exactly `localhost` or the hardcoded ngrok host - `127.0.0.1` fails the check, and the page then silently connects to the deployed runtime instead) *and* the value parses as `ws:` on `localhost`/`127.0.0.1`. This prevents connection hijacking via a crafted link - don't loosen it to accept `wss:` or arbitrary hosts.
- **Cognito role IAM policy**: The Cognito unauthenticated role needs `bedrock-agentcore:InvokeAgentRuntimeWithWebSocketStream` on `arn:aws:bedrock-agentcore:REGION:ACCOUNT:runtime/RUNTIME_ID*` (trailing `*` required - AgentCore evaluates the resource as both the bare ARN and `ARN/runtime-endpoint/DEFAULT` depending on the request phase). To debug the exact resource ARN in a 403, run `scripts/test_cognito_ws.py` with a deliberately wrong policy - the error body prints the full ARN. This does not work from the browser due to CORS.

### Client audio pipeline

Mic → `AudioWorkletNode` (`modules/mic-processor.js`, 4096-sample buffer) → downsample to 16 kHz → Int16 PCM → base64 → `bidi_audio_input` frames.

Received `bidi_audio_delta` audio is decoded from base64 → Int16 → Float32 and queued into an `AudioContext` buffer chain (`nextPlayTime`) to play gaplessly. On `bidi_barge_in`, `interruptPlayback()` stops every scheduled chunk and drops the agent text still waiting for its audio, but keeps the `AudioContext` alive - closing it would make `playAudio` drop the reply that follows, since the context is only created at session start (for mobile).

### Client UI

The client is `sonic/index.html` (markup only) + `styles/sonic.css` (on the site's `global.css` tokens) + `modules/sonic.js` and `modules/mic-processor.js`, living with the rest of the site's JS/CSS so CI minifies them and uploads sourcemaps to Sentry. Unqualified `sonic.js` in this file means `modules/sonic.js`.

Voice-first, with text as a first-class fallback in the same session: the mic orb starts a voice session, while typing or a prompt pill starts one without asking for the mic. `main#sonic[data-state]` (`idle`, `ready`, `connecting`, `listening`, `speaking`, `muted`, `ended`, `error`) drives the whole layout in CSS, and `setState()` is its only writer. Once expanded the layout is call-style: the conversation fills the box, with one centered cluster at the bottom - speaker / mic / end call, the status line, and a "Type instead" toggle that opens the input (`main.typing`; opened automatically when the conversation started from text or the mic was denied). The mic doubles as the visualizer: `renderLoop()` (rAF, only while a session runs) picks `speaking`/`listening`/`muted` and writes `--level` on the mic element alone, which drives its ring. Between conversations the mic reads as "start talking", and speaker/end are `visibility: hidden` so it stays centered.

- **Silence keeps the input stream alive**: a `ConstantSourceNode` (offset 0) always feeds the mic worklet, so text-only and muted sessions still send real-time `bidi_audio_input` frames of silence; the mic, when attached, goes through `micGain` (mute) on top. Don't drop the silent source to "save bandwidth" in text mode
- **Mic denied degrades to text**: `getUserMedia` failing at start shows `errorMic` and continues the session muted; the mic toggle can attach it later
- **Text typed before the session is up** (a pill, or the idle bar) becomes the agent's first turn via `config.firstMessage`, shown as a bubble and logged as turn 1; several typed while connecting are joined
- **Speaker mute is a gain of 0**, not skipping playback, so agent text still flushes on the audio timeline
- The user transcript of any text the client sent (`firstMessage` included) is skipped in `bidi_transcript_block`, via `lastSentText`
- **Privacy notice**: the homepage's `index.disclaimer` string is prepended as the conversation's first line when the chat first expands, since turns are logged. The landing carries none, so nothing shifts when the pills animate in
- **Turns are logged to Firestore** via the shared `modules/firebase.js` into `voice`/`voice-dev` (schema and rules in the root `CLAUDE.md`). A turn opens when the visitor's text is sent (`sendText`, or `firstMessage` for a pre-session question) or their speech transcript lands; agent sentences belong to the turn current when their audio was *scheduled*, not displayed, and are appended only once played. Writes are debounced (`LOG_DEBOUNCE`), serialized through `logQueue`, flushed on session end and tab hide; each session gets a fresh `chatLog` object so late writes never mix sessions
- **Loads site-wide `/modules`** (theme toggle, localization, validation, Firebase, Sentry, shared head, cookie banner) with absolute paths, so serve from the repo root and append `?ngrok` locally to get the plain `.js` instead of the CI-only `.min.js`. UI strings live under `sonic` in `locales/en.js` and `locales/pt.js`
- **Testing locally**: `python3 -m http.server` sends no cache headers, so Chrome can keep serving stale modules - keep DevTools → Network → **Disable cache** on, or a fix can look broken (an old `localization.js` without `lang` silently falls back to Tiffany). To test Portuguese (Carolina + `"Olá"`), set DevTools → Sensors → Location → Locale to `pt-BR` and reload with DevTools open

### Eager pre-loading

On page load, before any conversation starts, `sonic.js` kicks off non-blocking tasks:

1. **Credentials** - `ensureCredentials()` fetches Cognito temp credentials via `_credPromise`
2. **Signed URL** - `ensureSignedUrl()` chains off credentials to pre-build the SigV4 WebSocket URL via `_signedUrlPromise`
3. **WebSocket** - `ensureWebSocket()` chains off the signed URL (or `localWsUrl`) to open and hold an idle connection via `_wsPromise`, so the connect round-trip and AgentCore container boot happen before the click. The server just waits for `config` - no model work happens until a session actually starts. `startSession()` reuses it if still `OPEN`, otherwise opens a fresh one
4. **AudioWorklet** - an IIFE creates a silent `AudioContext`, calls `audioWorklet.addModule(MIC_PROCESSOR_URL)` (resolved against `import.meta.url`, `.min.js` outside ngrok) and only then keeps it as `_preAudioCtx`, so the worklet is compiled when `startAudioInput()` runs

**Ordering is load-bearing**: the pre-warm kick-off sits *above* the module's only top-level `await` (the locale strings), and every other UI dependency (Typed, validation, Firebase) is a lazy promise awaited where it's used. An `await` above the kick-off, or a CDN import awaited before `start()` wires the controls, delays pre-warm and lets early taps land before the handlers exist - measured at roughly +0.6s TTFA, plus occasional dead taps, for a tap ~1s after load. `sonic/index.html` also `modulepreload`s the module from `<head>`.

`startSession()` then races mic setup and the WebSocket (pre-warmed or fresh) in parallel (`Promise.all([inputPromise, openPromise])`) and sends config once both are ready.

### System prompt

The system prompt is fetched from Langfuse (prompt `GuiPT-Sonic`), not hardcoded. `init_langfuse()` warms the cache at server startup, and each session calls `get_prompt()` with a 600s cache TTL.

**Editing the prompt**: `scripts/prompt_sync.py pull|push` syncs against `agentcore/prompt.md` (gitignored by the `prompt*.md` rule, so draft variants next to it stay out of this public repo too). `pull` prints a diff before overwriting. **`push` does not go live** - it calls `create_prompt` with `labels=[]`, deliberately omitting `"production"`, so the version waits in Langfuse until promoted by hand. Since `pull` fetches the production version, pulling before promoting overwrites `prompt.md` with the old live prompt, losing what you just pushed. Same convention as `guipt`, `guimail` and `guido` - a push is never a deploy.

### Agent speaks first

`_WebSocketInput` (the input stream handed to `agent.run()`) sends the session's first turn from its `start()` hook, which GA calls once the model connection is live. That turn is `config.firstMessage`, chosen by the client:

- **Started from the mic orb**: the locale's `sonic.greeting` (`"Hello"` / `"Olá"`), never shown or logged. The prompt answers in the language of the latest turn, so this is what makes the first audio come back in the page's language - the client's localization detection (browser language, `en` default and fallback) is the single source of truth
- **Started from a pill or typed text**: the visitor's question itself, so the first reply is already the answer

`_clean_first_message()` falls back to `"Hello"` for a missing, empty or non-string value and caps it at `MAX_FIRST_MESSAGE_LENGTH`. A new server with an old client just greets as before, but an old server ignores `firstMessage` - so deploy the agent before the client, or pill questions get silently dropped.

### Strands GA events

The agent uses the GA `strands.bidi` API (`strands.experimental.bidi` is only a deprecated alias), and server `bidi_*` frames are Strands events forwarded as-is. `CLIENT_EVENT_TYPES` in `agent.py` allowlists what gets forwarded (deltas, usage etc. stay server-side); add a type there when the browser needs a new one. Inbound `bidi_audio_input` frames are base64-decoded into an `AudioDelta`, with the sample rate from the model's `audio` config. Model config is `region`/`voice`/`audio={...}` kwargs.

### Nova Sonic session ID

Strands doesn't surface Nova Sonic's own session ID, so `agent.py`'s `_SessionIdCapturingNovaSonicModel` overrides the private `_convert_nova_event` (sync; takes `*args` since its signature changed in GA) to peek at the raw `completionStart`/`usageEvent` payloads and capture it once via `self.session_id` + an `asyncio.Event`. `handle_websocket_session` relays it to the client as a `system` message. `sonic.js` doesn't render `system` frames; it regex-parses `Session ID: ...` out of that one for the `sonicSessionId` Sentry tag and Firestore field, so the message wording is load-bearing (`README.md` has a TODO to make it a structured field). It's unrelated to AgentCore's own `runtimeSessionId` header, which the browser can't set or read on a WebSocket handshake.

### Session start TTFA

The clock starts at the pill/typed-text press, or for the mic orb once `getUserMedia()` settles (granted or denied, so a first visit's permission prompt isn't counted), and stops at the first `bidi_audio_delta` frame - the greeting for the orb, the answer for a pill. That's system latency to the first audio byte, not audible playback (tens of milliseconds later), and not a per-turn metric. Once both it and `sonicSessionId` are in, `reportSessionStart()` prints them to the console (`[sonic] Session ID: ... | TTFA: ...s`, for testing in DevTools) and sends them to Sentry (a `[sonic] Session started` log plus a `sonicSessionStart` context), and it's also logged as the Firestore `ttfa` field.

### Deploy artifacts and redeployment

`deploy.py` reads `sonic/.env` and passes it as the runtime's `environmentVariables`: `LANGFUSE_SECRET_KEY`/`LANGFUSE_PUBLIC_KEY` for the prompt, `EMAIL_GUI`/`GMAIL_SENDER`/`GMAIL_APP_PASSWORD` for `send_email`. If the runtime already exists it calls `update_agent_runtime` with the new image and env vars, so re-running `deploy.py` is the whole update. An update is READY in about a minute; only a first-time create takes the 5-15 min the script warns about.

`deploy.py` builds the image from `agentcore/` as it is on local disk (the Dockerfile `COPY`s `server.py`/`agent.py`), not from git - so commit agent changes alongside the deploy, or production drifts from `main`.

`scripts/setup_config.json` (not committed) is written by `deploy.py` and read by `cleanup.py`. After a fresh deploy, `COGNITO_IDENTITY_POOL_ID` and `RUNTIME_WSS_BASE` must be pasted into `sonic.js` - the two values `deploy.py` prints for that. `sonic.js` also hardcodes `COGNITO_ROLE_ARN`, which `deploy.py` logs but doesn't include in the paste list; if that role is ever recreated, update it by hand.

### Planned refactor

`README.md`'s TODOs define the intended split of `sonic.js` (`auth.js`, `audio.js`, `tools.js` in `modules/`) and its eventual merge into the main site's `main.js` as a second mode alongside text chat. Read them before adding code here, so it lands where the split expects it.