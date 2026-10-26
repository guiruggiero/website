> Based on [agentcore-samples](https://github.com/awslabs/agentcore-samples/tree/main/01-tutorials/01-AgentCore-runtime/06-bi-directional-streaming/02-strands-ws) by AWS Labs.

# Minimal Nova Sonic Voice Agent

A minimal Nova Sonic voice agent with a single-page HTML client that deploys to GitHub Pages. Supports both voice (microphone) and text input.

## TODOs

- Split sonic.js when adding tools. Seams:
  - `auth.js` - getCredentials, buildSignedUrl, ensureCredentials, ensureSignedUrl
  - `audio.js` - startMic, stopMic, playAudio, stopPlayback, AudioContext pre-warm
  - `tools.js` - tool definitions and handlers
  - `sonic.js` - session orchestration, WS message routing, UI (absorbs into `main.js` at integration time)
- Integrate into main site: domain modules (auth.js, audio.js, tools.js) split out in `modules/`, next to `sonic.js` and `mic-processor.js`; CSS already lives in `styles/sonic.css`. Session orchestration (`sonic.js`) merges into `main.js` as a second mode alongside text GuiPT with conversation history.
  - Rename the Firestore collections `voice`/`voice-dev` to `v2` (and a dev counterpart) at the same time, not before - nobody uses Sonic while it lives at `/sonic`. Touches the Firebase Console rules (decide whether text and voice chats share `v2`; if so, the rules' key allowlists must cover both shapes), the collection pick in `sonic.js`, the `admin-firestore.html` picker, and the schema docs in the root `CLAUDE.md`
- Send Nova Sonic's session ID as a structured field (e.g. `{"type": "system", "message": "...", "sessionId": "..."}` from `_send_session_id` in `agent.py`) and read `data.sessionId` in `sonic.js`, instead of regex-parsing the `Session ID: ...` message text - today any rewording silently drops the `sonicSessionId` Sentry tag and Firestore field. Keep the old text in `message` so an un-updated client still works, and redeploy the agent before the client

## Architecture

```
GitHub Pages                   AWS (us-west-2)
──────────────                 ──────────────────────────────
../sonic.html                  AgentCore Runtime
  │  gets temp creds ──────→ Cognito Identity Pool (unauthenticated)
  │  signs WebSocket URL ──→ bedrock-agentcore SigV4
  └──────────────────────────→ /ws → BidiAgent → Nova Sonic
                                        ↑ system prompt
                                     Langfuse (us.cloud.langfuse.com)
```

- `../sonic.html`, `../modules/sonic.js` + `../modules/mic-processor.js`, `../styles/sonic.css` - pure static HTML/CSS/JS, deploy to GitHub Pages
- `agentcore/` - Docker image, runs on AgentCore
- `scripts/` - run once locally to create all AWS resources

## Prerequisites

- AWS account with Nova Sonic enabled in `us-west-2` (Bedrock Console → Model access → Amazon Nova → Enable)
- Docker with `docker buildx` support - install Docker Engine (`curl -fsSL https://get.docker.com | sh`)
- Python 3.12+ (required by the Strands Nova Sonic model)

Run all commands from the `sonic/` directory.

Install dependencies for both the agent and deploy scripts:

```bash
python3 -m pip install --user --break-system-packages -r agentcore/requirements.txt -r scripts/requirements.txt
```

Set the AWS and Langfuse credentials in your shell (add them to `~/.zshrc` / `~/.bashrc` to make them permanent):

```bash
export AWS_ACCESS_KEY_ID=...
export AWS_SECRET_ACCESS_KEY=...
export LANGFUSE_SECRET_KEY=...
export LANGFUSE_PUBLIC_KEY=...
```

Then create a `sonic/.env` file with the Langfuse and email keys (used by the deployed container at runtime):

```
LANGFUSE_SECRET_KEY=sk-lf-...
LANGFUSE_PUBLIC_KEY=pk-lf-...
EMAIL_GUI="..."
GMAIL_SENDER="..."
GMAIL_APP_PASSWORD="..."
```

## Step 1 - Local test

In one terminal in WSL, run the server:

```bash
python3 agentcore/server.py # starts on port 8080
```

The server serves the Langfuse prompt labeled `production`. To test an unpromoted version from `scripts/prompt_sync.py push`, start it with `LANGFUSE_PROMPT_LABEL=latest` instead.

In a second terminal, serve the client from the repo root (the page loads the site's shared `/modules`, `/styles` and `/images`):

```bash
python3 -m http.server 8001 --bind 0.0.0.0
```

Open `http://localhost:8001/sonic.html?ngrok&wsUrl=ws://localhost:8080/ws` - the `?wsUrl=` parameter bypasses Cognito for local testing, and `ngrok` makes the page load the shared modules' plain `.js` instead of the CI-only `.min.js`. Use `localhost`, not `127.0.0.1` - the page only honors `?wsUrl=` on a `localhost` hostname, and otherwise silently falls back to the deployed runtime. Tap the mic and speak, or type.

> **Windows note:** Port 8000 can conflict with other processes. Using `--bind 0.0.0.0` avoids an IPv6-only binding that some browsers can't reach.

## Step 2 - Deploy to AgentCore

In the WSL terminal, deploy to AgentCore:

```bash
python3 scripts/deploy.py
```

This takes 10–15 minutes on first run (re-deploys are faster - it updates the existing runtime). It will:
1. Build the Docker image for `linux/arm64` and push to ECR
2. Create an IAM execution role
3. Create the AgentCore Runtime and wait until it's `READY`
4. Create a Cognito Identity Pool so the browser can get temporary AWS credentials

When done, it prints two constants to paste into `../modules/sonic.js`:

```
const COGNITO_IDENTITY_POOL_ID = "us-west-2:xxxx...";
const RUNTIME_WSS_BASE = "wss://bedrock-agentcore.us-west-2.amazonaws.com/runtimes/.../ws";
```

After deploying, verify the IAM policy on the Cognito unauthenticated role (`MinimalSonicCognitoRole` → `InvokeRuntime` policy) matches:

```json
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Action": "bedrock-agentcore:InvokeAgentRuntimeWithWebSocketStream",
            "Resource": "arn:aws:bedrock-agentcore:us-west-2:ACCOUNT_ID:runtime/RUNTIME_ID*"
        }
    ]
}
```

The trailing `*` on the resource is required - AgentCore evaluates the ARN with a `/runtime-endpoint/DEFAULT` suffix during authorization.

## Step 3 - Configure and deploy client

Paste the two constants into the `CONFIG` block at the top of `../modules/sonic.js`, then deploy `../sonic.html`, `../modules/sonic.js`, `../modules/mic-processor.js`, and `../styles/sonic.css` to the website.

You can also change `VOICE_ID` in the same block to customise the agent's personality.

## Step 4 - Test the connection

Run these commands in the WSL terminal.

**Quick check - IAM credentials (test_ws.py)**

```bash
python3 scripts/test_ws.py
```

This generates a SigV4-presigned URL using your local AWS credentials and attempts a WebSocket connection. A successful run prints `WebSocket connected!`. The HTTPS 400 line before it is expected - it's a diagnostic probe that hits the WebSocket endpoint with a plain HTTP GET to capture the raw server response.

**Full browser simulation - Cognito flow (test_cognito_ws.py)**

```bash
python3 scripts/test_cognito_ws.py
```

This replicates the exact browser flow: Cognito unauthenticated identity → OpenID token → STS role assumption → SigV4-signed WebSocket URL. It then runs a real session - sends `config`, waits for the agent's opening greeting, and exits after `bidi_response_stop`. Use this to confirm the end-to-end path works before testing in the browser.

**End-to-end test - browser with localhost**

In the second terminal, serve the client from the repo root:

```bash
python3 -m http.server 8001 --bind 0.0.0.0
```

Open `http://localhost:8001/sonic.html?ngrok`, tap the mic, and speak.

## Cleanup

```bash
python3 scripts/cleanup.py
```

Deletes the AgentCore Runtime, Cognito pool, and IAM roles. Asks before deleting the ECR repository.

## Files

| File | Purpose |
|------|---------|
| `agentcore/server.py` | FastAPI server - `/ping`, `/invocations`, `/ws` |
| `agentcore/agent.py` | `BidiAgent` + `BedrockNovaSonicModel` session handler |
| `agentcore/Dockerfile` | `linux/arm64` image for AgentCore |
| `../sonic.html` | Page markup - site header/footer, mic orb hero, chat window with call bar and input |
| `../styles/sonic.css` | UI styles, built on the site's `global.css` design tokens |
| `../modules/sonic.js` | Voice agent logic (auth, WebSocket, audio), UI state, and Firestore turn logging |
| `../modules/mic-processor.js` | `AudioWorkletProcessor` - downsamples mic input to 16 kHz Int16 PCM |
| `scripts/deploy.py` | Creates all AWS resources |
| `scripts/cleanup.py` | Tears all resources down |
| `scripts/test_ws.py` | Generates a SigV4-presigned URL and tests the WebSocket connection |
| `scripts/test_cognito_ws.py` | Tests the WebSocket connection using the same Cognito → STS → SigV4 flow as the browser |
