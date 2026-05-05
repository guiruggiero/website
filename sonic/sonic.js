// ---------------------------------------------------------------------------
// CONFIG — paste the two values printed by deploy/deploy.py after deploying
// ---------------------------------------------------------------------------
const COGNITO_IDENTITY_POOL_ID = "us-west-2:c71bd164-55c9-4dba-9abd-fec92b8b5de4";
const COGNITO_ROLE_ARN = "arn:aws:iam::250711740447:role/MinimalSonicCognitoRole";
const RUNTIME_WSS_BASE = "wss://bedrock-agentcore.us-west-2.amazonaws.com/runtimes/arn%3Aaws%3Abedrock-agentcore%3Aus-west-2%3A250711740447%3Aruntime%2Fminimal_sonic_agent-XNEC1PGRQK/ws";
const REGION = "us-west-2";

// Voice ID
const VOICE = "tiffany";
// ---------------------------------------------------------------------------

const INPUT_SAMPLE_RATE = 16000;
const OUTPUT_SAMPLE_RATE = 16000;

let ws = null;
let audioContext = null;
let audioPlaybackContext = null;
let nextPlayTime = 0;
let audioCarryover = null;
let isRunning = false;
let pendingAgentTranscript = null; // Agent text and audio sync

// Local-dev override: append ?wsUrl=ws://localhost:8080/ws to bypass Cognito
const params = new URLSearchParams(location.search);
const localWsUrl = params.get("wsUrl");

if (localWsUrl) {
    const bar = document.getElementById("localBar");
    bar.style.display = "block";
    bar.textContent = `Local dev mode — connecting to: ${localWsUrl}`;
}

// Expose toggle() globally for the inline onclick
window.toggle = toggle;

function setStatus(text) {
    document.getElementById("status").textContent = text;
}

function addMsg(text, cls) {
    const t = document.getElementById("transcript");
    t.style.display = "block";
    const d = document.createElement("div");
    d.className = "msg " + cls;
    d.textContent = text;
    t.appendChild(d);
    t.scrollTop = t.scrollHeight;
}

// ---------------------------------------------------------------------------
// SigV4-signed WebSocket URL - TODO: reduce startup time
// ---------------------------------------------------------------------------
async function buildSignedUrl(creds) {
    const { SignatureV4 } = await import("https://cdn.jsdelivr.net/npm/@smithy/signature-v4/+esm");
    const { Sha256 } = await import("https://cdn.jsdelivr.net/npm/@aws-crypto/sha256-browser/+esm");

    const host = "bedrock-agentcore." + REGION + ".amazonaws.com";
    const rawPath = RUNTIME_WSS_BASE.replace(/^wss:\/\/[^/]+/, "");
    // Fully decode so Smithy re-encodes with its own rules to match what botocore produces
    const decodedPath = decodeURIComponent(rawPath);

    const signer = new SignatureV4({
        service: "bedrock-agentcore",
        region: REGION,
        credentials: creds,
        sha256: Sha256,
    });

    const signed = await signer.presign(
        {
            method: "GET",
            headers: { host },
            hostname: host,
            path: decodedPath,
            query: { qualifier: "DEFAULT" },
            protocol: "https:",
        },
        { expiresIn: 300 },
    );

    // Use signed.path so the URL matches the canonical URI Smithy signed over
    const qs = Object.entries(signed.query || {})
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
        .join("&");
    return `wss://${host}${signed.path}?${qs}`;
}

// ---------------------------------------------------------------------------
// Cognito unauthenticated credentials
// ---------------------------------------------------------------------------
async function getCredentials() {
    const { CognitoIdentityClient, GetIdCommand, GetOpenIdTokenCommand } =
        await import("https://cdn.jsdelivr.net/npm/@aws-sdk/client-cognito-identity/+esm");
    const { STSClient, AssumeRoleWithWebIdentityCommand } =
        await import("https://cdn.jsdelivr.net/npm/@aws-sdk/client-sts/+esm");

    const cognitoClient = new CognitoIdentityClient({ region: REGION });

    const { IdentityId } = await cognitoClient.send(
        new GetIdCommand({ IdentityPoolId: COGNITO_IDENTITY_POOL_ID }),
    );

    const { Token } = await cognitoClient.send(
        new GetOpenIdTokenCommand({ IdentityId }),
    );

    const stsClient = new STSClient({ region: REGION });
    const { Credentials } = await stsClient.send(
        new AssumeRoleWithWebIdentityCommand({
            RoleArn: COGNITO_ROLE_ARN,
            RoleSessionName: "sonic-browser",
            WebIdentityToken: Token,
        }),
    );

    return {
        accessKeyId: Credentials.AccessKeyId,
        secretAccessKey: Credentials.SecretAccessKey,
        sessionToken: Credentials.SessionToken,
    };
}

// ---------------------------------------------------------------------------
// Audio playback queue (Int16 PCM from base64) - TODO: built-in noise cancelation?
// ---------------------------------------------------------------------------
async function playAudio(base64) {
    if (!audioPlaybackContext) {
        audioPlaybackContext = new AudioContext({ sampleRate: OUTPUT_SAMPLE_RATE });
        nextPlayTime = audioPlaybackContext.currentTime;
    }
    if (audioPlaybackContext.state === "suspended") {
        await audioPlaybackContext.resume();
    }

    const binary = atob(base64);
    let bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

    if (audioCarryover) {
        const merged = new Uint8Array(1 + bytes.length);
        merged[0] = audioCarryover;
        merged.set(bytes, 1);
        bytes = merged;
        audioCarryover = null;
    }
    if (bytes.length & 1) audioCarryover = bytes[bytes.length - 1];
    const int16 = new Int16Array(bytes.buffer, 0, bytes.length >> 1);
    const float32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) float32[i] = int16[i] / 32768;

    const buf = audioPlaybackContext.createBuffer(1, float32.length, OUTPUT_SAMPLE_RATE);
    buf.getChannelData(0).set(float32);

    const now = audioPlaybackContext.currentTime;
    if (nextPlayTime < now) nextPlayTime = now;

    const src = audioPlaybackContext.createBufferSource();
    src.buffer = buf;
    src.connect(audioPlaybackContext.destination);

    // Agent text and audio sync - flush pending transcript exactly when this chunk starts playing
    if (pendingAgentTranscript !== null) {
        const transcript = pendingAgentTranscript;
        pendingAgentTranscript = null;
        const delayMs = Math.max(0, (nextPlayTime - audioPlaybackContext.currentTime) * 1000);
        setTimeout(() => addMsg(`Agent: ${transcript}`, "assistant"), delayMs);
    }

    src.start(nextPlayTime);
    nextPlayTime += buf.duration;
}

function stopPlayback() {
    if (audioPlaybackContext) {
        audioPlaybackContext.close();
        audioPlaybackContext = null;
        nextPlayTime = 0;
    }
    audioCarryover = null;
}

// ---------------------------------------------------------------------------
// Microphone capture → bidi_audio_input - TODO: text input (+UI)
// ---------------------------------------------------------------------------
async function startMic() {
    const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
    });

    audioContext = new AudioContext();
    const source = audioContext.createMediaStreamSource(stream);
    // TODO: migrate to AudioWorkletNode to replace deprecated ScriptProcessorNode
    // [Deprecation] The ScriptProcessorNode is deprecated. Use AudioWorkletNode instead. (https://bit.ly/audio-worklet)
    // startMic @ sonic.js:194
    // await in startMic
    // ws.onopen @ sonic.js:273
    const processor = audioContext.createScriptProcessor(4096, 1, 1);

    processor.onaudioprocess = (e) => {
        if (!ws || ws.readyState !== WebSocket.OPEN) return;

        const raw = e.inputBuffer.getChannelData(0);
        const ratio = audioContext.sampleRate / INPUT_SAMPLE_RATE;
        const out = new Int16Array(Math.floor(raw.length / ratio));

        for (let i = 0; i < out.length; i++) {
            const s = raw[Math.floor(i * ratio)];
            out[i] = Math.max(-32768, Math.min(32767, s * 32768));
        }

        const bytes = new Uint8Array(out.buffer);
        let bin = "";
        for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);

        ws.send(JSON.stringify({
            type: "bidi_audio_input",
            audio: btoa(bin),
            format: "pcm",
            sample_rate: INPUT_SAMPLE_RATE,
            channels: 1,
        }));
    };

    source.connect(processor);
    processor.connect(audioContext.destination);
}

function stopMic() {
    if (audioContext) {
        audioContext.close();
        audioContext = null;
    }
}

// ---------------------------------------------------------------------------
// Session lifecycle - TODO: speak first
// ---------------------------------------------------------------------------
async function toggle() {
    if (isRunning) {
        endSession();
    } else {
        await startSession();
    }
}

async function startSession() {
    const btn = document.getElementById("toggleBtn");
    btn.disabled = true;
    setStatus("Connecting…");

    try {
        let wsUrl;

        if (localWsUrl) {
            wsUrl = localWsUrl;
        } else {
            if (COGNITO_IDENTITY_POOL_ID.includes("REPLACE") || RUNTIME_WSS_BASE.includes("REPLACE")) {
                throw new Error("Deploy the agent first and paste COGNITO_IDENTITY_POOL_ID and RUNTIME_WSS_BASE into index.html");
            }
            setStatus("Getting credentials…");
            const creds = await getCredentials();
            setStatus("Signing URL…");
            wsUrl = await buildSignedUrl(creds);
        }

        ws = new WebSocket(wsUrl);

        ws.onopen = async () => {
            setStatus("Configuring agent…");

            ws.send(JSON.stringify({
                type: "config",
                voice: VOICE,
            }));

            await startMic();
            isRunning = true;
            btn.textContent = "End Session";
            btn.classList.add("active");
            btn.disabled = false;
            setStatus("Listening…");
            addMsg("Session started", "system");
        };

        ws.onmessage = async (event) => {
            const data = JSON.parse(event.data);

            switch (data.type) {
                case "bidi_audio_stream":
                    setStatus("Speaking…");
                    await playAudio(data.audio);
                    break;

                case "bidi_transcript_stream": {
                    const isUser = data.role === "user";

                    // Agent text and audio sync
                    // if (isUser ? data.is_final : !data.is_final){
                    //     addMsg(`${isUser ? "You" : "Agent"}: ${data.text}`, isUser ? "user" : "assistant");
                    // }
                    if (isUser) {
                        if (data.is_final) addMsg(`You: ${data.text}`, "user");
                    } else if (!data.is_final) {
                        pendingAgentTranscript = data.text;
                    }
                    break;
                }

                case "bidi_interruption":
                    stopPlayback();
                    setStatus("Listening…");
                    break;

                case "bidi_response_complete":
                    setStatus("Listening…");
                    break;

                case "system":
                    addMsg(data.message, "system");
                    break;

                case "error":
                    addMsg("Error: " + data.message, "system");
                    break;
            }
        };

        ws.onerror = () => {
            addMsg("Connection error", "system");
            endSession();
        };

        ws.onclose = () => {
            if (isRunning) {
                addMsg("Disconnected", "system");
                endSession();
            }
        };

    } catch (err) {
        addMsg("Failed to start: " + err.message, "system");
        setStatus("Error — check console");
        console.error(err);
        btn.disabled = false;
    }
}

function endSession() {
    isRunning = false;
    stopMic();
    stopPlayback();
    if (ws) {
        ws.close();
        ws = null;
    }
    const btn = document.getElementById("toggleBtn");
    btn.textContent = "Start Session";
    btn.classList.remove("active");
    btn.disabled = false;
    setStatus("Idle");
    addMsg("Session ended", "system");
}
