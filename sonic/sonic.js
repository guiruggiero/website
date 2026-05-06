// Imports
const _smithyP = import("https://cdn.jsdelivr.net/npm/@smithy/signature-v4/+esm");
const _sha256P = import("https://cdn.jsdelivr.net/npm/@aws-crypto/sha256-browser/+esm");
const _cognitoP = import("https://cdn.jsdelivr.net/npm/@aws-sdk/client-cognito-identity/+esm");
const _stsP = import("https://cdn.jsdelivr.net/npm/@aws-sdk/client-sts/+esm");

// Initializations
const COGNITO_IDENTITY_POOL_ID = "us-west-2:c71bd164-55c9-4dba-9abd-fec92b8b5de4";
const COGNITO_ROLE_ARN = "arn:aws:iam::250711740447:role/MinimalSonicCognitoRole";
const RUNTIME_WSS_BASE = "wss://bedrock-agentcore.us-west-2.amazonaws.com/runtimes/arn%3Aaws%3Abedrock-agentcore%3Aus-west-2%3A250711740447%3Aruntime%2Fminimal_sonic_agent-XNEC1PGRQK/ws";
const REGION = "us-west-2";
const VOICE_ID = "tiffany"; // "carolina"
const INPUT_SAMPLE_RATE = 16000;
const OUTPUT_SAMPLE_RATE = 16000;

// DOM elements
const elements = {
    status: document.querySelector("#status"),
    transcript: document.querySelector("#transcript"),
    toggleBtn: document.querySelector("#toggleBtn"),
    localBar: document.querySelector("#localBar"),
    textInput: document.querySelector("#textInput"),
    sendBtn: document.querySelector("#sendBtn"),
};

// State
let ws = null;
let audioContext = null;
let audioPlaybackContext = null;
let nextPlayTime = 0;
let audioCarryover = null;
let isRunning = false;
let pendingAgentTranscript = null; // Agent text and audio sync

// Local-dev override, bypass Cognito
const params = new URLSearchParams(globalThis.location?.search);
const localWsUrl = params.get("wsUrl");

// Pre-warm: credentials and signed URL (fetched eagerly at page load, cached for reuse)
let _credPromise = null;
let _credTimestamp = 0;
const CRED_TTL = 50 * 60 * 1000;

function ensureCredentials() {
    if (!_credPromise || (Date.now() - _credTimestamp) > CRED_TTL) {
        _credTimestamp = Date.now();
        _credPromise = getCredentials();
    }
    return _credPromise;
}

let _signedUrlPromise = null;
let _signedUrlTimestamp = 0;
const URL_TTL = 12 * 60 * 1000;

function ensureSignedUrl() {
    if (!_signedUrlPromise || (Date.now() - _signedUrlTimestamp) > URL_TTL) {
        _signedUrlTimestamp = Date.now();
        _signedUrlPromise = ensureCredentials().then(buildSignedUrl);
    }
    return _signedUrlPromise;
}

// Pre-warm: AudioWorklet module (loaded at page idle, reused on click)
let _preAudioCtx = null;
let _workletReady = false;

(async () => {
    try {
        _preAudioCtx = new AudioContext();
        await _preAudioCtx.audioWorklet.addModule("mic-processor.js");
        _workletReady = true;
    } catch { /* browser may block without gesture — harmless */ }
})();

// Update the status indicator
function setStatus(text) {
    elements.status.textContent = text;
}

// Add a message to the transcript
function addMessage(text, cls) {
    elements.transcript.style.display = "block";
    const d = document.createElement("div");
    d.className = `msg ${cls}`;
    d.textContent = text;
    elements.transcript.appendChild(d);
    elements.transcript.scrollTop = elements.transcript.scrollHeight;
}

// Build a SigV4-signed WebSocket URL from temporary credentials
async function buildSignedUrl(creds) {
    const {SignatureV4} = await _smithyP;
    const {Sha256} = await _sha256P;

    const host = `bedrock-agentcore.${REGION}.amazonaws.com`;
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
            headers: {host},
            hostname: host,
            path: decodedPath,
            query: {qualifier: "DEFAULT"},
            protocol: "https:",
        },
        {expiresIn: 900},
    );

    // Rebuild query string from signed params and use signed.path so the URL matches the canonical URI Smithy signed over
    const qs = Object.entries(signed.query || {})
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
        .join("&");
    return `wss://${host}${signed.path}?${qs}`;
}

// Get temporary AWS credentials from Cognito unauthenticated identity
async function getCredentials() {
    const {CognitoIdentityClient, GetIdCommand, GetOpenIdTokenCommand} = await _cognitoP;
    const {STSClient, AssumeRoleWithWebIdentityCommand} = await _stsP;

    // Get an unauthenticated Cognito identity ID, then exchange it for an OpenID token
    const cognitoClient = new CognitoIdentityClient({region: REGION});
    const {IdentityId} = await cognitoClient.send(
        new GetIdCommand({IdentityPoolId: COGNITO_IDENTITY_POOL_ID}),
    );
    const {Token} = await cognitoClient.send(
        new GetOpenIdTokenCommand({IdentityId}),
    );

    // Exchange the OpenID token for temporary STS credentials via role assumption
    const stsClient = new STSClient({region: REGION});
    const {Credentials} = await stsClient.send(
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

// Decode base64 PCM audio and queue it for gapless playback
async function playAudio(base64) {
    // Initialize playback context on first chunk
    if (!audioPlaybackContext) {
        audioPlaybackContext = new AudioContext({sampleRate: OUTPUT_SAMPLE_RATE});
        nextPlayTime = audioPlaybackContext.currentTime;
    }
    if (audioPlaybackContext.state === "suspended") {
        await audioPlaybackContext.resume();
    }

    // Decode base64 to raw bytes
    const binary = atob(base64);
    let bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

    // Prepend leftover byte from previous chunk if Int16 boundary was split
    if (audioCarryover) {
        const merged = new Uint8Array(1 + bytes.length);
        merged[0] = audioCarryover;
        merged.set(bytes, 1);
        bytes = merged;
        audioCarryover = null;
    }
    if (bytes.length & 1) audioCarryover = bytes[bytes.length - 1]; // Save trailing byte for next chunk

    // Convert Int16 PCM to Float32 for Web Audio
    const int16 = new Int16Array(bytes.buffer, 0, bytes.length >> 1);
    const float32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) float32[i] = int16[i] / 32768;

    // Schedule chunk at the end of the playback queue for gapless output
    const buf = audioPlaybackContext.createBuffer(1, float32.length, OUTPUT_SAMPLE_RATE);
    buf.getChannelData(0).set(float32);

    const now = audioPlaybackContext.currentTime;
    if (nextPlayTime < now) nextPlayTime = now; // Catch up if queue fell behind

    const src = audioPlaybackContext.createBufferSource();
    src.buffer = buf;
    src.connect(audioPlaybackContext.destination);

    // Flush pending transcript exactly when this chunk starts playing
    if (pendingAgentTranscript !== null) {
        const transcript = pendingAgentTranscript;
        pendingAgentTranscript = null;
        const delayMs = Math.max(0, (nextPlayTime - audioPlaybackContext.currentTime) * 1000);
        setTimeout(() => addMessage(`Agent: ${transcript}`, "assistant"), delayMs);
    }

    src.start(nextPlayTime);
    nextPlayTime += buf.duration;
}

// Stop and reset the audio playback context
function stopPlayback() {
    if (audioPlaybackContext) {
        audioPlaybackContext.close();
        audioPlaybackContext = null;
        nextPlayTime = 0;
    }
    audioCarryover = null;
}

// Capture microphone input and stream it as bidi_audio_input frames
async function startMic() {
    const stream = await navigator.mediaDevices.getUserMedia({
        audio: {channelCount: 1, echoCancellation: true, noiseSuppression: true},
    });

    // Reuse pre-loaded AudioContext + worklet module, or create fresh
    if (_preAudioCtx && _workletReady) {
        audioContext = _preAudioCtx;
        _preAudioCtx = null;
        if (audioContext.state === "suspended") await audioContext.resume();
    } else {
        audioContext = new AudioContext();
        await audioContext.audioWorklet.addModule("mic-processor.js");
    }

    const source = audioContext.createMediaStreamSource(stream);
    const worklet = new AudioWorkletNode(audioContext, "mic-processor");

    // Forward each downsampled PCM chunk to the WebSocket
    worklet.port.onmessage = (e) => {
        if (!ws || ws.readyState !== WebSocket.OPEN) return;

        // Convert ArrayBuffer to base64
        const bytes = new Uint8Array(e.data);
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

    source.connect(worklet);
    worklet.connect(audioContext.destination);
}

// Close and reset the microphone AudioContext
function stopMic() {
    if (audioContext) {
        audioContext.close();
        audioContext = null;
    }
}

// Send a text message to the agent over the open WebSocket
function sendTextInput() {
    const text = elements.textInput.value.trim();
    if (!text || !ws || ws.readyState !== WebSocket.OPEN) return;

    ws.send(JSON.stringify({type: "text_input", text}));
    addMessage(`You: ${text}`, "user");
    elements.textInput.value = "";
}

// Toggle the session on or off
async function toggle() {
    if (isRunning) {
        endSession();
    } else {
        await startSession();
    }
}

// Connect to AgentCore and start a bidi session
async function startSession() {
    elements.toggleBtn.disabled = true;
    setStatus("Connecting…");

    try {
        // Resolve WebSocket URL, local override bypasses Cognito entirely
        let wsUrl;
        if (localWsUrl) {
            wsUrl = localWsUrl;
        } else {
            if (COGNITO_IDENTITY_POOL_ID.includes("REPLACE") || RUNTIME_WSS_BASE.includes("REPLACE")) {
                throw new Error("Deploy the agent first and paste COGNITO_IDENTITY_POOL_ID and RUNTIME_WSS_BASE into sonic.js");
            }
            wsUrl = await ensureSignedUrl();
        }

        // Start mic and WebSocket connection in parallel
        const micPromise = startMic();
        ws = new WebSocket(wsUrl);

        const openPromise = new Promise((resolve, reject) => {
            ws.onopen = resolve;
            ws.onerror = () => reject(new Error("WebSocket connection failed"));
        });

        await Promise.all([micPromise, openPromise]);

        // Both ready — send config and go live
        setStatus("Configuring agent…");
        ws.send(JSON.stringify({type: "config", voice: VOICE_ID}));

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
                    if (isUser) {
                        if (data.is_final) addMessage(`You: ${data.text}`, "user");
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
                    addMessage(data.message, "system");
                    break;

                case "session_end":
                    isRunning = false; // voice-based end doesn't show "Disconnected"
                    endSession();
                    break;

                case "error":
                    addMessage(`Error: ${data.message}`, "system");
                    break;
            }
        };

        ws.onerror = () => {
            addMessage("Connection error", "system");
            endSession();
        };

        ws.onclose = () => {
            if (isRunning) {
                addMessage("Disconnected", "system");
                endSession();
            }
        };

        isRunning = true;
        elements.toggleBtn.textContent = "End Session";
        elements.toggleBtn.classList.add("active");
        elements.toggleBtn.disabled = false;
        elements.textInput.disabled = false;
        elements.sendBtn.disabled = false;
        elements.textInput.focus();
        setStatus("Listening…");
        addMessage("Session started", "system");

    } catch (error) {
        addMessage(`Failed to start: ${error.message}`, "system");
        setStatus("Error");
        elements.toggleBtn.disabled = false;
        stopMic();
    }
}

// Tear down the WebSocket and audio streams
function endSession() {
    isRunning = false;
    stopMic();
    stopPlayback();
    if (ws) {
        ws.close();
        ws = null;
    }
    elements.toggleBtn.textContent = "Start Session";
    elements.toggleBtn.classList.remove("active");
    elements.toggleBtn.disabled = false;
    elements.textInput.disabled = true;
    elements.textInput.value = "";
    elements.sendBtn.disabled = true;
    setStatus("Idle");
    addMessage("Session ended", "system");
}

// Debounce helper
function debounce(fn, ms) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

// Wire up UI and show local-dev banner if override URL is set
function start() {
    elements.toggleBtn?.addEventListener("pointerup", toggle);
    elements.sendBtn?.addEventListener("pointerup", sendTextInput);
    elements.textInput?.addEventListener("keyup", debounce((e) => {
        if (e.key === "Enter") sendTextInput();
    }, 150));

    if (localWsUrl) {
        elements.localBar.style.display = "block";
        elements.localBar.textContent = `Local dev mode — connecting to: ${localWsUrl}`;
    }
}

// Check if page is already loaded
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
else start();

// Kick off credential + URL pre-warming (non-blocking, runs in background)
if (!localWsUrl && !COGNITO_IDENTITY_POOL_ID.includes("REPLACE")) {
    ensureSignedUrl();
}