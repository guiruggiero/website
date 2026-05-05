> Based on [agentcore-samples](https://github.com/awslabs/agentcore-samples/tree/main/01-tutorials/01-AgentCore-runtime/06-bi-directional-streaming/02-strands-ws) by AWS Labs.

# Minimal Nova Sonic Voice Agent

A minimal Nova Sonic voice agent with a single-button HTML page that deploys to GitHub Pages.

## Architecture

```
GitHub Pages                    AWS (us-west-2)
──────────────                  ──────────────────────────────
index.html                      AgentCore Runtime
  │  gets temp creds ──────→  Cognito Identity Pool (unauthenticated)
  │  signs WebSocket URL ──→  bedrock-agentcore SigV4
  └──────────────────────────→ /ws → BidiAgent → Nova Sonic
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

# Windows PowerShell
$env:AWS_ACCESS_KEY_ID = "..."
$env:AWS_SECRET_ACCESS_KEY = "..."
$env:AWS_DEFAULT_REGION = "us-west-2"

cd agentcore
python server.py  # starts on port 8080
```

In a second terminal, serve the client from `sonic/`:

```bash
python -m http.server 8001 --bind 0.0.0.0
```

Open `http://127.0.0.1:8001?wsUrl=ws://localhost:8080/ws` — the `?wsUrl=` parameter bypasses Cognito for local testing. Click **Start Session** and speak.

> **Windows note:** Port 8000 can conflict with other processes. Using `--bind 0.0.0.0` avoids an IPv6-only binding that some browsers can't reach.

## Step 2 — Deploy to AgentCore

```bash
cd scripts
python -m pip install -r requirements.txt
python deploy.py
```

This takes 10–15 minutes on first run. It will:
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

You can also change `VOICE` in the same block to customise the agent's personality.

## Step 4 — Test the connection

```bash
cd scripts
python test_ws.py
```

This generates a SigV4-presigned URL using your local AWS credentials and attempts a WebSocket connection. A successful run prints `WebSocket connected!`. The HTTPS 400 line before it is expected — it's a diagnostic probe that hits the WebSocket endpoint with a plain HTTP GET to capture the raw server response.

## Step 5 — Cleanup

```bash
python scripts/cleanup.py
```

Deletes the AgentCore Runtime, Cognito pool, and IAM roles. Asks before deleting the ECR repository.

## Migrating the hosting to GCP (keeping Nova Sonic)

<!-- TODO: what about runtime-server? -->

Nova Sonic is an AWS Bedrock API — the container must still call AWS regardless of where it runs. What you're moving is only where the Docker container is hosted and how the browser authenticates to reach it.

**1. Container hosting — AgentCore → Cloud Run**

The `agentcore/` container runs unchanged on Cloud Run (it's a plain FastAPI server on port 8080, and Cloud Run natively supports WebSocket). Changes needed:
- Push the image to Google Artifact Registry instead of ECR
- Deploy with `gcloud run deploy --allow-unauthenticated` (or with Cloud Run auth — see point 3)
- Remove the `/ping` and `/invocations` endpoints — those are AgentCore protocol requirements and serve no purpose on Cloud Run
- Remove the IMDS credential refresh loop — that's EC2-specific. Instead, inject AWS credentials as Cloud Run environment variables (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_DEFAULT_REGION`), or use Workload Identity Federation to give the Cloud Run service account permission to assume an AWS IAM role (avoids long-lived keys)

**2. Browser auth — Cognito + SigV4 → direct WebSocket**

The Cognito pool and SigV4 URL signing exist because AgentCore requires AWS authentication on its WebSocket endpoint. Cloud Run has no such requirement. If the service is `--allow-unauthenticated`, the browser connects with a plain `wss://your-service.run.app/ws` — the entire Cognito + SigV4 block in `sonic.js` is replaced with a direct `new WebSocket(url)` call.

For access control on a public Cloud Run service, the simplest option is to add a shared secret: the deploy script generates a random token, sets it as a Cloud Run env var, and the browser passes it as a query param (`/ws?token=...`) which the server validates before accepting the connection.

**What stays the same:**
- `agentcore/agent.py` — `BidiAgent` + `BidiNovaSonicModel` + all session logic
- `split_large_event` in `server.py`
- `index.html`, `sonic.css`, `sonic.js` — the audio pipeline, Web Audio API code, and WebSocket message protocol are unchanged

## Files

| File | Purpose |
|------|---------|
| `agentcore/server.py` | FastAPI server — `/ping`, `/invocations`, `/ws` |
| `agentcore/agent.py` | `BidiAgent` + `BidiNovaSonicModel` session handler |
| `agentcore/Dockerfile` | `linux/arm64` image for AgentCore |
| `index.html` | HTML shell — markup and importmap only |
| `sonic.css` | All UI styles |
| `sonic.js` | Voice agent logic (config, WebSocket, audio) |
| `scripts/deploy.py` | Creates all AWS resources |
| `scripts/cleanup.py` | Tears all resources down |
| `scripts/test_ws.py` | Generates a SigV4-presigned URL and tests the WebSocket connection |
| `scripts/test_cognito_ws.py` | Tests the WebSocket connection using the same Cognito → STS → SigV4 flow as the browser |
