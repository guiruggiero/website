> Based on [agentcore-samples](https://github.com/awslabs/agentcore-samples/tree/main/01-tutorials/01-AgentCore-runtime/06-bi-directional-streaming/02-strands-ws) by AWS Labs.

# Minimal Nova Sonic Voice Agent

A minimal Nova Sonic voice agent with a single-page HTML client that deploys to GitHub Pages. Supports both voice (microphone) and text input.

## TODOs

- Split sonic.js when adding tools. Seams:
  - `auth.js` — getCredentials, buildSignedUrl, ensureCredentials, ensureSignedUrl
  - `audio.js` — startMic, stopMic, playAudio, stopPlayback, AudioContext pre-warm
  - `tools.js` — tool definitions and handlers
  - `sonic.js` — session orchestration, WS message routing, UI (absorbs into `main.js` at integration time)
- Integrate into main site: domain modules move to `modules/sonic/` (auth.js, audio.js, tools.js, mic-processor.js), CSS to `styles/sonic.css`. Session orchestration (`sonic.js`) merges into `main.js` as a second mode alongside text GuiPT with conversation history.
- Sentry error capture and logging
- Minimization and deployment

## Architecture

```
GitHub Pages                    AWS (us-west-2)
──────────────                  ──────────────────────────────
index.html                      AgentCore Runtime
  │  gets temp creds ──────→  Cognito Identity Pool (unauthenticated)
  │  signs WebSocket URL ──→  bedrock-agentcore SigV4
  └──────────────────────────→ /ws → BidiAgent → Nova Sonic
                                       ↑ system prompt
                                     Langfuse (us.cloud.langfuse.com)
```

- `index.html`, `sonic.css`, `sonic.js` — pure static HTML/CSS/JS, deploy to GitHub Pages
- `agentcore/` — Docker image, runs on AgentCore
- `scripts/` — run once locally to create all AWS resources
- `terminal/` — standalone terminal scripts for local Nova Sonic experiments

## Prerequisites

- AWS account with Nova Sonic enabled in `us-west-2` (Bedrock Console → Model access → Amazon Nova → Enable)
- Docker with `docker buildx` support — on Linux install Docker Engine (`curl -fsSL https://get.docker.com | sh`); on Windows use WSL2 Docker Engine (same command inside WSL2)
- Python 3.11+

## Step 1 — Local test

```bash
# Linux
python3 -m venv .venv && source .venv/bin/activate

# Windows PowerShell
python -m venv .venv-win && .venv-win\Scripts\activate

python -m pip install -r agentcore/requirements.txt
python -m pip install "strands-agents[bidi]"

# Linux
export AWS_ACCESS_KEY_ID=...
export AWS_SECRET_ACCESS_KEY=...
export AWS_DEFAULT_REGION="us-west-2"
export LANGFUSE_SECRET_KEY=...
export LANGFUSE_PUBLIC_KEY=...

# Windows PowerShell
$env:AWS_ACCESS_KEY_ID = "..."
$env:AWS_SECRET_ACCESS_KEY = "..."
$env:AWS_DEFAULT_REGION = "us-west-2"
$env:LANGFUSE_SECRET_KEY = "..."
$env:LANGFUSE_PUBLIC_KEY = "..."

cd agentcore
python server.py # starts on port 8080
```

In a second terminal, serve the client from `sonic/`:

```bash
python -m http.server 8001 --bind 0.0.0.0
```

Open `http://127.0.0.1:8001?wsUrl=ws://localhost:8080/ws` — the `?wsUrl=` parameter bypasses Cognito for local testing. Click **Start Session** and speak.

> **Windows note:** Port 8000 can conflict with other processes. Using `--bind 0.0.0.0` avoids an IPv6-only binding that some browsers can't reach.

## Step 2 — Deploy to AgentCore

Create a `sonic/.env` file with the Langfuse keys (used by the container at runtime):

```
LANGFUSE_SECRET_KEY=sk-lf-...
LANGFUSE_PUBLIC_KEY=pk-lf-...
```

Then deploy:

```bash
cd scripts
python -m pip install -r requirements.txt
python deploy.py
```

This takes 10–15 minutes on first run (re-deploys are faster — it updates the existing runtime). It will:
1. Build the Docker image for `linux/arm64` and push to ECR
2. Create an IAM execution role
3. Create the AgentCore Runtime and wait until it's `READY`
4. Create a Cognito Identity Pool so the browser can get temporary AWS credentials

When done, it prints two constants to paste into `sonic.js`:

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

The trailing `*` on the resource is required — AgentCore evaluates the ARN with a `/runtime-endpoint/DEFAULT` suffix during authorization.

## Step 3 — Configure and deploy client

Paste the two constants into the `CONFIG` block at the top of `sonic.js`, then deploy `index.html`, `sonic.css`, and `sonic.js` the website.

You can also change `VOICE_ID` in the same block to customise the agent's personality.

## Step 4 — Test the connection

**Quick check — IAM credentials (test_ws.py)**

```bash
cd scripts
python test_ws.py
```

This generates a SigV4-presigned URL using your local AWS credentials and attempts a WebSocket connection. A successful run prints `WebSocket connected!`. The HTTPS 400 line before it is expected — it's a diagnostic probe that hits the WebSocket endpoint with a plain HTTP GET to capture the raw server response.

**Full browser simulation — Cognito flow (test_cognito_ws.py)**

```bash
python test_cognito_ws.py
```

This replicates the exact browser flow: Cognito unauthenticated identity → OpenID token → STS role assumption → SigV4-signed WebSocket URL. It then runs a real session — sends `config`, waits for the agent's opening greeting, and exits after `bidi_response_complete`. Use this to confirm the end-to-end path works before testing in the browser.

## Step 5 — Cleanup

```bash
python scripts/cleanup.py
```

Deletes the AgentCore Runtime, Cognito pool, and IAM roles. Asks before deleting the ECR repository.

## Files

| File | Purpose |
|------|---------|
| `agentcore/server.py` | FastAPI server — `/ping`, `/invocations`, `/ws` |
| `agentcore/agent.py` | `BidiAgent` + `BidiNovaSonicModel` session handler |
| `agentcore/Dockerfile` | `linux/arm64` image for AgentCore |
| `index.html` | HTML shell — head structure, header/footer, loads `sonic.js` via `loadScript` |
| `sonic.css` | All UI styles |
| `sonic.js` | Voice agent logic (config, WebSocket, audio) |
| `mic-processor.js` | `AudioWorkletProcessor` — downsamples mic input to 16 kHz Int16 PCM |
| `scripts/deploy.py` | Creates all AWS resources |
| `scripts/cleanup.py` | Tears all resources down |
| `scripts/test_ws.py` | Generates a SigV4-presigned URL and tests the WebSocket connection |
| `scripts/test_cognito_ws.py` | Tests the WebSocket connection using the same Cognito → STS → SigV4 flow as the browser |
