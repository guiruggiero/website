// Import module dynamically
async function importModule(path) {
    if (globalThis.location?.href.includes("ngrok")) return await import(path.replace(".min.js", ".js"));
    else return await import(path);
}

// Imports
const _smithyP = import("https://cdn.jsdelivr.net/npm/@smithy/signature-v4/+esm");
const _sha256P = import("https://cdn.jsdelivr.net/npm/@aws-crypto/sha256-browser/+esm");
const _cognitoP = import("https://cdn.jsdelivr.net/npm/@aws-sdk/client-cognito-identity/+esm");
const _stsP = import("https://cdn.jsdelivr.net/npm/@aws-sdk/client-sts/+esm");
const _typedP = import("https://cdn.jsdelivr.net/npm/typed.js/+esm");
const _langDataP = importModule("./localization.min.js").then(module => module.getLangData());
const _validationP = importModule("./validation.min.js"); // Only awaited on submit
const _firebaseP = importModule("./firebase.min.js").catch(() => null); // Only awaited at the first log write, null if blocked

// Initializations
const COGNITO_IDENTITY_POOL_ID = "us-west-2:c71bd164-55c9-4dba-9abd-fec92b8b5de4";
const COGNITO_ROLE_ARN = "arn:aws:iam::250711740447:role/MinimalSonicCognitoRole";
const RUNTIME_WSS_BASE = "wss://bedrock-agentcore.us-west-2.amazonaws.com/runtimes/arn%3Aaws%3Abedrock-agentcore%3Aus-west-2%3A250711740447%3Aruntime%2Fminimal_sonic_agent-XNEC1PGRQK/ws";
const REGION = "us-west-2";
const VOICES = {en: "tiffany", pt: "carolina"}; // Per page language, Carolina is Nova Sonic's Brazilian Portuguese voice
const OUTPUT_SAMPLE_RATE = 24000; // Must match OUTPUT_SAMPLE_RATE in agentcore/agent.py, the playback context is created at click time (mobile), before any audio frame can report its rate
const SPEAKING_HOLD = 300; // Keeps "speaking" steady across tiny gaps between audio chunks
const ANALYSER_SIZE = 512; // fftSize for both level meters, sizes the shared buffer below
const levelBuffer = new Float32Array(ANALYSER_SIZE); // Reused every frame instead of allocating one
const LOG_DEBOUNCE = 1500; // Batches a turn's sentences into one Firestore write
const MIC_PROCESSOR_URL = new URL(globalThis.location?.href.includes("ngrok") ? "mic-processor.js" : "mic-processor.min.js", import.meta.url).href; // Relative to this module, not the page

// DOM elements
const elements = {
    sonic: document.querySelector("#sonic"),
    orb: document.querySelector("#orb"),
    statusText: document.querySelector("#status-text"),
    speakerToggle: document.querySelector("#speaker-toggle"),
    endCall: document.querySelector("#end-call"),
    chatWindow: document.querySelector("#chat-window"),
    messagesContainer: document.querySelector(".messages-container"),
    micToggle: document.querySelector("#mic-toggle"),
    typeToggle: document.querySelector("#type-toggle"),
    input: document.querySelector("#prompt"),
    submit: document.querySelector("#submit"),
    promptPillsContainer: document.querySelector("#prompt-pills-container"),
    localBar: document.querySelector("#local-bar"),
};

// State
let ws = null;
let audioContext = null;
let micStream = null;
let micGain = null;
let micAnalyser = null;
let micEnabled = false;
let audioPlaybackContext = null;
let outputBus = null;
let outputGain = null;
let outputAnalyser = null;
let speakerEnabled = true;
let nextPlayTime = 0;
let audioCarryover = null;
let isRunning = false;
let isStarting = false;
let pendingAgentTranscript = null; // Agent text and audio sync
const activeSources = new Set(); // Scheduled playback chunks, so a barge-in can silence them
const transcriptTimers = new Set(); // Agent text waiting for its audio to start, cleared on barge-in
let sessionStartTime = null;
let currentBotMessage = null; // Agent sentences of the same turn share one bubble
let lastSentText = null; // Skips the echo if typed text comes back as a user transcript
let queuedText = null; // Typed before the session was up, sent as the agent's first turn instead of a greeting
let rafId = null;
let lastSpeakingAt = 0;
let smoothedLevel = 0;
let lastLevelText = "0";
let placeholderTyped = null;
let disclaimerShown = false;
let chatLog = null; // Current session's Firestore log, a fresh object per session so a late write never mixes sessions
let currentTurn = null; // Turn the agent's next sentences belong to, captured when they're scheduled
let logTimer = null;
let logQueue = Promise.resolve(); // Serializes writes, so the create always lands before any update

// Local-dev override, bypass Cognito
const isDev = globalThis.location?.hostname === "localhost" || globalThis.location?.hostname === "probable-firmly-gobbler.ngrok-free.app";
const params = new URLSearchParams(globalThis.location?.search);

// Prevent connection hijacking via a crafted "wsUrl" link
function sanitizeLocalWsUrl(rawUrl) {
    if (!isDev || !rawUrl) return null;
    let parsed;
    try {
        parsed = new URL(rawUrl);
    } catch {
        return null;
    }
    const isLoopbackHost = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
    if (parsed.protocol !== "ws:" || !isLoopbackHost) return null;
    return parsed.href;
}

const localWsUrl = sanitizeLocalWsUrl(params.get("wsUrl"));

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

// Pre-warm: idle WebSocket connection (opened eagerly, reused on click to skip the connect round-trip)
let _wsPromise = null;

function ensureWebSocket() {
    if (!_wsPromise) {
        _wsPromise = (async () => {
            const url = localWsUrl || await ensureSignedUrl();
            const socket = new WebSocket(url);
            await new Promise((resolve, reject) => {
                socket.onopen = resolve;
                socket.onerror = () => reject(new Error("Pre-warm WebSocket connection failed"));
            });
            return socket;
        })().catch(() => null); // Harmless if it fails, startSession() opens a fresh one
    }
    return _wsPromise;
}

// Pre-warm: AudioWorklet module (loaded at page idle, reused on click)
let _preAudioCtx = null; // Only set once its worklet module has loaded

void (async () => {
    try {
        const context = new AudioContext();
        await context.audioWorklet.addModule(MIC_PROCESSOR_URL);
        _preAudioCtx = context;
    } catch {/* browser may block without gesture - harmless */}
})();

// Kick off WebSocket pre-warming (non-blocking, runs in background - also warms credentials + signed URL)
if (localWsUrl || !COGNITO_IDENTITY_POOL_ID.includes("REPLACE")) {
    ensureWebSocket();
}

// UI strings, awaited only once pre-warming is underway so they never delay it - the rest of the UI dependencies load lazily
const langData = await _langDataP;
const t = langData.sonic;
const statusLabels = {
    ready: t.statusReady,
    connecting: t.statusConnecting,
    listening: t.statusListening,
    speaking: t.statusSpeaking,
    muted: t.statusMuted,
    ended: t.statusEnded,
    error: t.statusError,
};

// --- Auth ---

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

// --- UI ---

// Page state drives the layout and colors in sonic.css: idle, ready, connecting, listening, speaking, muted, ended, error
function setState(state) {
    if (elements.sonic.dataset.state === state) return;
    elements.sonic.dataset.state = state;

    // Same privacy notice as the homepage, as the conversation's first line once the chat expands - chats are logged
    if (state !== "idle" && !disclaimerShown) {
        disclaimerShown = true;
        elements.messagesContainer.prepend(addMessage("system", langData.disclaimer));
    }

    elements.statusText.textContent = statusLabels[state] ?? "";
}

// Scroll to the latest message
function scrollToBottom() {
    elements.chatWindow.scrollTop = elements.chatWindow.scrollHeight;
}

// Add a message bubble: user, bot, error, or system
function addMessage(type, text) {
    const message = document.createElement("div");
    if (type === "system") message.classList.add("system-message");
    else message.classList.add("message", `${type}-message`);
    message.textContent = text;
    if (type === "user") message.setAttribute("aria-label", langData.userMessage + text);
    elements.messagesContainer.appendChild(message);
    scrollToBottom();
    return message;
}

// Append agent text to the current turn's bubble, or start a new one
function addAgentText(text) {
    if (currentBotMessage) {
        currentBotMessage.textContent += ` ${text.trim()}`;
        scrollToBottom();
    } else currentBotMessage = addMessage("bot", text.trim());
    currentBotMessage.setAttribute("aria-label", langData.guiptResponse + currentBotMessage.textContent);
}

// Add a user message, which also closes the agent's current bubble
function addUserMessage(text) {
    currentBotMessage = null;
    addMessage("user", text);
}

// Reflect mic state on its toggle
function renderMicToggle() {
    // Between conversations the mic reads as "start talking", not as a muted mic
    const on = micEnabled || !isRunning;
    elements.micToggle.classList.toggle("on", on);
    elements.micToggle.innerHTML = `<iconify-icon icon="ph:${on ? "microphone-bold" : "microphone-slash-bold"}"></iconify-icon>`;
    let micLabel = t.orb;
    if (isRunning) micLabel = micEnabled ? t.micOn : t.micOff;
    elements.micToggle.setAttribute("aria-label", micLabel);
    if (isRunning) elements.micToggle.setAttribute("aria-pressed", String(micEnabled));
    else elements.micToggle.removeAttribute("aria-pressed");
}

// Show or hide the text input during a conversation
function setTyping(open) {
    elements.sonic.classList.toggle("typing", open);
}

// Reflect speaker state on its toggle
function renderSpeakerToggle() {
    elements.speakerToggle.innerHTML = `<iconify-icon icon="ph:${speakerEnabled ? "speaker-high-bold" : "speaker-slash-bold"}"></iconify-icon>`;
    elements.speakerToggle.setAttribute("aria-label", speakerEnabled ? t.speakerOn : t.speakerOff);
    elements.speakerToggle.setAttribute("aria-pressed", String(!speakerEnabled));
}

// Allow/forbid submit button according to input content
function toggleSubmitButton() {
    elements.submit.classList.toggle("active", elements.input.value.trim().length > 0);
}

// Root mean square of an analyser's current frame, scaled to 0-1
function readLevel(analyser) {
    if (!analyser) return 0;
    analyser.getFloatTimeDomainData(levelBuffer);
    let sum = 0;
    for (const sample of levelBuffer) sum += sample * sample;
    return Math.min(1, Math.sqrt(sum / levelBuffer.length) * 5);
}

// Per-frame loop: who's talking, and how loud, for the status and the mic's ring
function renderLoop() {
    const now = performance.now();
    if (activeSources.size > 0) lastSpeakingAt = now;
    const speaking = now - lastSpeakingAt < SPEAKING_HOLD;

    // Connecting stays put until the session is live
    if (isRunning) {
        if (speaking) setState("speaking");
        else setState(micEnabled ? "listening" : "muted");
    }

    // Smooth the level so the ring doesn't jitter, and skip the style write when nothing changed
    let level = 0;
    if (speaking) level = readLevel(outputAnalyser);
    else if (micEnabled) level = readLevel(micAnalyser);
    smoothedLevel += (level - smoothedLevel) * 0.3;
    const levelText = smoothedLevel.toFixed(3);
    if (levelText !== lastLevelText) {
        elements.micToggle.style.setProperty("--level", levelText);
        lastLevelText = levelText;
    }

    rafId = requestAnimationFrame(renderLoop);
}

// Stop the render loop and flatten the ring
function stopRenderLoop() {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
    smoothedLevel = 0;
    lastLevelText = "0";
    elements.micToggle.style.setProperty("--level", "0");
}

// --- Audio ---

// Decode base64 PCM audio and queue it for gapless playback
async function playAudio(base64) {
    if (!audioPlaybackContext) return;
    if (audioPlaybackContext.state === "suspended") {
        await audioPlaybackContext.resume();
    }

    // Decode base64 to raw bytes
    const binary = atob(base64);
    let bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.codePointAt(i);

    // Prepend leftover byte from previous chunk if Int16 boundary was split
    if (audioCarryover) {
        const merged = new Uint8Array(1 + bytes.length);
        merged[0] = audioCarryover;
        merged.set(bytes, 1);
        bytes = merged;
        audioCarryover = null;
    }
    if (bytes.length & 1) audioCarryover = bytes.at(-1); // Save trailing byte for next chunk

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
    src.connect(outputBus);

    // Flush pending transcript exactly when this chunk starts playing
    if (pendingAgentTranscript !== null) {
        const transcript = pendingAgentTranscript;
        const turn = currentTurn; // Generated in reply to this turn, even if displayed after the next one starts
        pendingAgentTranscript = null;
        const delayMs = Math.max(0, (nextPlayTime - audioPlaybackContext.currentTime) * 1000);
        const timer = setTimeout(() => {
            transcriptTimers.delete(timer);
            addAgentText(transcript);
            logAgentText(turn, transcript); // Only what actually played, a barge-in cancels this timer
        }, delayMs);
        transcriptTimers.add(timer);
    }

    activeSources.add(src);
    src.onended = () => activeSources.delete(src);
    src.start(nextPlayTime);
    nextPlayTime += buf.duration;
}

// Create the playback context: chunks → bus (metered) → volume → speakers
async function startPlayback() {
    audioPlaybackContext = new AudioContext({sampleRate: OUTPUT_SAMPLE_RATE});
    await audioPlaybackContext.resume();
    nextPlayTime = audioPlaybackContext.currentTime;

    outputBus = audioPlaybackContext.createGain();
    outputAnalyser = audioPlaybackContext.createAnalyser();
    outputAnalyser.fftSize = ANALYSER_SIZE;
    outputGain = audioPlaybackContext.createGain();
    outputGain.gain.value = speakerEnabled ? 1 : 0; // Muted still plays silently, so text stays in sync with the audio timeline

    outputBus.connect(outputAnalyser);
    outputBus.connect(outputGain);
    outputGain.connect(audioPlaybackContext.destination);
}

// Silence everything queued but keep the playback context alive, so the reply after a barge-in still plays
function interruptPlayback() {
    for (const src of activeSources) {
        try {
            src.stop();
        } catch {
            // Already ended
        }
    }
    activeSources.clear();
    for (const timer of transcriptTimers) clearTimeout(timer);
    transcriptTimers.clear();
    pendingAgentTranscript = null;
    nextPlayTime = audioPlaybackContext?.currentTime ?? 0;
    audioCarryover = null;
}

// Stop and reset the audio playback context
function stopPlayback() {
    interruptPlayback();
    if (audioPlaybackContext) {
        audioPlaybackContext.close();
        audioPlaybackContext = null;
        outputBus = null;
        outputGain = null;
        outputAnalyser = null;
        nextPlayTime = 0;
    }
}

// Stream audio input as bidi_audio_input frames: silence always, plus the mic once attached
async function startAudioInput(stream) {
    // Reuse pre-loaded AudioContext + worklet module, or create fresh
    if (_preAudioCtx) {
        audioContext = _preAudioCtx;
        _preAudioCtx = null;
        if (audioContext.state === "suspended") await audioContext.resume();
    } else {
        audioContext = new AudioContext();
        await audioContext.audioWorklet.addModule(MIC_PROCESSOR_URL);
    }

    const worklet = new AudioWorkletNode(audioContext, "mic-processor");

    // Forward each downsampled PCM chunk to the WebSocket
    worklet.port.onmessage = (e) => {
        if (ws?.readyState !== WebSocket.OPEN) return;

        // Convert ArrayBuffer to base64
        const bytes = new Uint8Array(e.data);
        let bin = "";
        for (const byte of bytes) bin += String.fromCodePoint(byte);

        ws.send(JSON.stringify({
            type: "bidi_audio_input",
            audio: btoa(bin),
            format: "pcm",
        }));
    };

    // Silent source keeps frames flowing at real-time pace, so text-only and muted sessions look like quiet audio to the model
    const silenceSource = new ConstantSourceNode(audioContext, {offset: 0});
    silenceSource.connect(worklet);
    silenceSource.start();

    // Mic goes through a gain (mute) and an analyser (level)
    micGain = audioContext.createGain();
    micAnalyser = audioContext.createAnalyser();
    micAnalyser.fftSize = ANALYSER_SIZE;
    micGain.connect(worklet);
    micGain.connect(micAnalyser);

    worklet.connect(audioContext.destination);

    if (stream) attachMic(stream);
}

// Plug a mic stream into the running input graph
function attachMic(stream) {
    micStream = stream;
    const micSource = audioContext.createMediaStreamSource(stream);
    micSource.connect(micGain);
    setMicEnabled(true);
    if (chatLog && !chatLog.micUsed) {
        chatLog.micUsed = true;
        scheduleLog();
    }
}

// Mute or unmute the mic, sending silence while muted
function setMicEnabled(enabled) {
    micEnabled = enabled;
    if (micGain) micGain.gain.value = enabled ? 1 : 0;
    micStream?.getAudioTracks().forEach(track => track.enabled = enabled);
    renderMicToggle();
}

// Ask for the mic
function getMicStream() {
    return navigator.mediaDevices.getUserMedia({
        audio: {channelCount: 1, echoCancellation: true, noiseSuppression: true},
    });
}

// Close and reset the microphone AudioContext
function stopMic() {
    if (micStream) {
        micStream.getTracks().forEach(track => track.stop());
        micStream = null;
    }
    if (audioContext) {
        audioContext.close();
        audioContext = null;
    }
    micGain = null;
    micAnalyser = null;
    micEnabled = false;
    renderMicToggle();
}

// --- Session ---

// Send a text message to the agent over the open WebSocket
function sendText(text) {
    ws.send(JSON.stringify({type: "text_input", text}));
    lastSentText = text.toLowerCase();
    startTurn(text, "typed");
}

// Handle text input: validate, then send now or start a text-first session
async function handleSubmit() {
    const Validation = await _validationP; // Long resolved by the time anyone has typed
    const sanitizedInput = Validation.sanitizeInput(elements.input.value);
    const validationResult = Validation.validateInput(sanitizedInput);

    // Don't act on input if input doesn't pass validation
    if (validationResult.assessment === "Empty") return;
    setTyping(true); // They're typing, keep the input open once the chat expands
    if (validationResult.assessment !== "OK") {
        if (elements.sonic.dataset.state === "idle") setState("ready"); // Open the chat window to show the error
        addMessage("error", validationResult.errorMessage);
        return;
    }

    elements.input.value = "";
    toggleSubmitButton();
    addUserMessage(sanitizedInput);

    if (isRunning) sendText(sanitizedInput);
    else {
        queuedText = queuedText ? `${queuedText} ${sanitizedInput}` : sanitizedInput; // Several typed while connecting go as one
        if (!isStarting) await startSession({withMic: false});
    }
}

// Mic toggle: start a voice session, add the mic to a text session, or mute/unmute
async function handleMicToggle() {
    if (!isRunning) {
        if (!isStarting) await startSession({withMic: true});
        return;
    }

    if (micStream) {
        setMicEnabled(!micEnabled);
        return;
    }

    // Text-first session, ask for the mic now
    try {
        elements.micToggle.disabled = true;
        const stream = await getMicStream();
        if (isRunning && audioContext) attachMic(stream);
        else stream.getTracks().forEach(track => track.stop());
    } catch (error) {
        addMessage("error", t.errorMic);
        captureError(error, "Mic access failed mid-session");
    } finally {
        elements.micToggle.disabled = false;
    }
}

// Speaker toggle: mute GuiPT but keep the transcript flowing
function handleSpeakerToggle() {
    speakerEnabled = !speakerEnabled;
    if (outputGain) outputGain.gain.value = speakerEnabled ? 1 : 0;
    renderSpeakerToggle();
}

// Record time to first audio the first time audio arrives
function recordTtfa() {
    if (!sessionStartTime) return;
    chatLog.ttfa = Number(((performance.now() - sessionStartTime) / 1000).toFixed(3)); // Seconds
    sessionStartTime = null;
    reportSessionStart();
}

// A finished user transcript block: show it and start a turn, unless it only echoes typed text
function handleUserTranscript(rawTranscript) {
    const transcript = rawTranscript?.trim();
    if (!transcript) return;

    // Skip the echo of typed text, the first turn included
    if (transcript.toLowerCase() === lastSentText) {
        lastSentText = null;
        return;
    }

    addUserMessage(transcript);
    startTurn(transcript, "spoken");
}

// Not shown to visitors, only the session ID is kept, for Sentry
function handleSystemMessage(message) {
    const sessionIdMatch = message?.match(/^Session ID: (.+)$/);
    if (!sessionIdMatch) return;

    chatLog.sonicSessionId = sessionIdMatch[1];
    if (typeof Sentry !== "undefined") Sentry.setTag("sonicSessionId", chatLog.sonicSessionId);
    reportSessionStart();
}

// Route server frames
async function handleServerMessage(event) {
    const data = JSON.parse(event.data);

    switch (data.type) {
        case "bidi_audio_delta":
            recordTtfa();
            await playAudio(data.audio);
            break;

        case "bidi_transcript_delta":
            // Agent text arrives per sentence, ahead of its audio (the final block only lands after playback has been queued)
            if (data.role === "assistant") pendingAgentTranscript = (pendingAgentTranscript ?? "") + data.delta;
            break;

        case "bidi_transcript_block":
            if (data.role === "user") handleUserTranscript(data.transcript);
            break;

        case "bidi_barge_in":
            interruptPlayback();
            currentBotMessage = null;
            break;

        case "system":
            handleSystemMessage(data.message);
            break;

        case "session_end":
            endSession();
            break;

        case "error":
            addMessage("error", langData.errorGeneric);
            captureError(new Error(data.message), "Server error frame");
            break;
    }
}

// Connect to AgentCore and start a bidi session
async function startSession({withMic}) {
    isStarting = true;
    sessionStartTime = performance.now();
    currentBotMessage = null;
    currentTurn = null;
    chatLog = {id: null, start: Date.now(), turns: {}, turnCount: 0, micUsed: false, sonicSessionId: null, ttfa: null, dirty: false};
    setState("connecting");
    renderLoop();

    try {
        // Acquire mic and create playback context immediately, needed for mobile browsers
        let stream = null;
        if (withMic) {
            try {
                stream = await getMicStream();
            } catch (error) {
                // No mic, still have a conversation by text
                addMessage("error", t.errorMic);
                setTyping(true);
                captureError(error, "Mic access failed at session start");
            }

            // Restart the TTFA clock once the mic settles, so the permission prompt's human wait isn't counted as latency
            sessionStartTime = performance.now();
        }
        await startPlayback();

        // Local override bypasses Cognito entirely, otherwise the agent must be deployed first
        if (!localWsUrl && (COGNITO_IDENTITY_POOL_ID.includes("REPLACE") || RUNTIME_WSS_BASE.includes("REPLACE"))) {
            throw new Error("Deploy the agent first and paste COGNITO_IDENTITY_POOL_ID and RUNTIME_WSS_BASE into sonic.js");
        }

        // Wire up the input graph using the already-acquired stream, if any
        const inputPromise = startAudioInput(stream);

        // Reuse the pre-warmed idle connection if it's still open, otherwise open a fresh one
        const preWarmed = await ensureWebSocket();
        let openPromise;
        if (preWarmed?.readyState === WebSocket.OPEN) {
            ws = preWarmed;
            openPromise = Promise.resolve();
        } else {
            ws = new WebSocket(localWsUrl || await ensureSignedUrl());
            openPromise = new Promise((resolve, reject) => {
                ws.onopen = resolve;
                ws.onerror = () => reject(new Error("WebSocket connection failed"));
            });
        }

        await Promise.all([inputPromise, openPromise]);

        // Both ready, send config and go live - the first turn is the visitor's question (pill or typed) or a greeting in the page's language, so the first reply is already the answer, in that language
        const firstMessage = queuedText ?? t.greeting;
        ws.send(JSON.stringify({type: "config", voice: VOICES[langData.lang] ?? VOICES.en, firstMessage}));
        lastSentText = firstMessage.toLowerCase();
        if (queuedText) startTurn(queuedText, "typed"); // Already on screen, the greeting is never shown or logged
        queuedText = null;
        ws.onmessage = handleServerMessage;

        ws.onerror = () => {
            addMessage("error", t.errorDisconnected);
            captureError(new Error("WebSocket error mid-session"), "Connection error");
            endSession();
        };

        ws.onclose = () => {
            if (isRunning) {
                addMessage("error", t.errorDisconnected);
                endSession();
            }
        };

        isRunning = true;
        renderMicToggle();
        changePlaceholder(t.replyPlaceholder);

    } catch (error) {
        addMessage("error", t.errorConnection);
        captureError(error, "Session start failed");
        teardown();
        setState("error");
    } finally {
        isStarting = false;
    }
}

// Tear down the WebSocket and audio streams, shared by a failed start and a normal end
function teardown() {
    isRunning = false;
    queuedText = null;
    stopRenderLoop();
    stopMic();
    stopPlayback();
    if (ws) {
        ws.onclose = null;
        ws.close();
        ws = null;
    }
}

// End the conversation
function endSession() {
    if (!ws && !isRunning) return;
    teardown();
    currentBotMessage = null;
    lastSentText = null;
    currentTurn = null;
    flushLog();
    setState("ended");
    addMessage("system", t.sessionEnded);
}

// --- Logging ---

// Open a new turn in the log when the user speaks or types
function startTurn(text, input) {
    if (!chatLog) return;
    chatLog.turnCount++;
    currentTurn = {user: text, model: "", input};
    chatLog.turns[chatLog.turnCount] = currentTurn;
    scheduleLog();
}

// Add a played sentence to the turn it answers; the greeting has no turn and isn't logged
function logAgentText(turn, text) {
    if (!turn) return;
    turn.model = turn.model ? `${turn.model} ${text.trim()}` : text.trim();
    scheduleLog();
}

// Write once the agent pauses, instead of on every sentence
function scheduleLog() {
    if (chatLog) chatLog.dirty = true;
    clearTimeout(logTimer);
    logTimer = setTimeout(flushLog, LOG_DEBOUNCE);
}

// Queue a write of the current log right away
function flushLog() {
    clearTimeout(logTimer);
    logTimer = null;
    const log = chatLog;
    if (!log?.turnCount || !log.dirty) return;
    log.dirty = false;
    logQueue = logQueue.then(() => writeLog(log));
}

// Create the log on the first write, then update it with the whole turn history
async function writeLog(log) {
    try {
        // Snapshot, since the log keeps changing while the write is in flight
        const turnHistory = structuredClone(log.turns);
        const turnCount = log.turnCount;
        const extraFields = {micUsed: log.micUsed};
        if (log.sonicSessionId) extraFields.sonicSessionId = log.sonicSessionId;
        if (log.ttfa !== null) extraFields.ttfa = log.ttfa;

        const Firebase = await _firebaseP;
        if (!Firebase) throw new Error("Firebase SDK failed to load");
        if (!log.id) {
            log.id = await Firebase.createLog(log.start, turnHistory, {collectionName: Firebase.voiceCollection, turnCount, extraFields});
            if (!log.id) log.dirty = true; // Create failed (already reported by firebase.js), retry on the next flush
        } else {
            // Duration only from turn 2 onward, and the rules reject a 0
            const duration = Number(((Date.now() - log.start) / 60000).toFixed(2)); // Minutes
            await Firebase.logTurn(log.id, turnCount, turnCount > 1 && duration > 0 ? duration : undefined, turnHistory, {collectionName: Firebase.voiceCollection, extraFields});
        }
    } catch (error) {
        captureError(error, "Firestore log write");
    }
}

// Log the session start to the console and Sentry once both the TTFA and the session ID are in, whichever lands last
function reportSessionStart() {
    if (chatLog.ttfa === null || !chatLog.sonicSessionId) return;
    const {sonicSessionId, ttfa: sessionTtfa} = chatLog;

    // Handy in DevTools while testing, no need to open the admin viewer or Firebase Console
    console.info(`[sonic] Session ID: ${sonicSessionId} | TTFA: ${sessionTtfa}s`);

    if (typeof Sentry === "undefined") return;
    Sentry.setContext("sonicSessionStart", {sonicSessionId, sessionTtfa});
    Sentry.logger?.info(`[sonic] Session started (TTFA ${sessionTtfa}s)`, {sonicSessionId, sessionTtfa, micEnabled});
}

// Report to Sentry with session context, if it loaded
function captureError(error, stage) {
    if (typeof Sentry === "undefined") return;
    Sentry.captureException(error, {contexts: {
        sonicSession: {
            stage,
            state: elements.sonic.dataset.state,
            isRunning,
            micEnabled,
            speakerEnabled,
            wsReadyState: ws?.readyState ?? null,
            sonicSessionId: chatLog?.sonicSessionId ?? null,
            sessionTtfa: chatLog?.ttfa ?? null,
            localWsUrl: Boolean(localWsUrl),
            errorName: error?.name,
            errorMessage: error?.message,
        },
    }});
}

// Change input placeholder, stopping the typing animation if still running
function changePlaceholder(text) {
    placeholderTyped?.destroy();
    placeholderTyped = null;
    elements.input.placeholder = text;
}

// Shuffle an array (Fisher-Yates)
function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
}

// Display example prompts as pills, each starting a text-first conversation
function displayPromptPills() {
    const prompts = [...langData.promptPills];
    shuffleArray(prompts);

    prompts.slice(0, 3).forEach((promptText, index) => {
        const pill = document.createElement("div");
        pill.textContent = promptText;
        pill.classList.add("prompt-pill", "hidden");
        pill.setAttribute("role", "button");
        pill.tabIndex = 0;

        pill.addEventListener("pointerup", () => {
            elements.input.value = promptText;
            void handleSubmit();
        });

        elements.promptPillsContainer.appendChild(pill);
        setTimeout(() => pill.classList.remove("hidden"), 100 * (index + 1));
    });
}

// Debounce helper
function debounce(fn, ms) {
    let timer;
    return (...args) => {clearTimeout(timer); timer = setTimeout(() => fn(...args), ms);};
}

// Wire up UI and show local-dev banner if override URL is set
function start() {
    renderMicToggle();
    renderSpeakerToggle();

    // Type input placeholder, like the homepage - lazily, so a CDN fetch never holds up the controls below
    void _typedP.then(({default: Typed}) => {
        if (elements.sonic.dataset.state !== "idle") return; // Conversation already started, keep its placeholder
        placeholderTyped = new Typed(elements.input, {
            strings: [t.inputPlaceholder],
            contentType: "null",
            attr: "placeholder",
            typeSpeed: 10,
            showCursor: false,
        });
    }).catch(() => elements.input.placeholder = t.inputPlaceholder.replace("^1", ""));

    elements.orb.addEventListener("pointerup", handleMicToggle);
    elements.micToggle.addEventListener("pointerup", handleMicToggle);
    elements.speakerToggle.addEventListener("pointerup", handleSpeakerToggle);
    elements.endCall.addEventListener("pointerup", endSession);
    elements.typeToggle.addEventListener("pointerup", () => {
        setTyping(true);
        elements.input.focus();
    });
    elements.submit.addEventListener("pointerup", handleSubmit);

    // Enter submits right away (not debounced) so audio still starts inside the user gesture
    elements.input.addEventListener("input", debounce(toggleSubmitButton, 150));
    elements.input.addEventListener("keydown", (event) => {
        if (event.key === "Enter" && !event.isComposing) void handleSubmit();
    });

    // Keyboard access for pointerup-only controls
    for (const button of [elements.orb, elements.micToggle, elements.speakerToggle, elements.endCall, elements.typeToggle, elements.submit]) {
        button.addEventListener("keydown", (event) => {
            if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                button.dispatchEvent(new Event("pointerup"));
            }
        });
    }
    elements.promptPillsContainer.addEventListener("keydown", (event) => {
        if (event.target.classList.contains("prompt-pill") && (event.key === "Enter" || event.key === " ")) {
            event.preventDefault();
            event.target.dispatchEvent(new Event("pointerup"));
        }
    });

    setTimeout(displayPromptPills, 1000);

    if (localWsUrl) {
        elements.localBar.style.display = "block";
        elements.localBar.textContent = `Local dev mode - connecting to: ${localWsUrl}`;
    }
}

// Best-effort write of the last turn when the visitor leaves or switches tabs
document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushLog();
});

// Check if page is already loaded
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
else start();
