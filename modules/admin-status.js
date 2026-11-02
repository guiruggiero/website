// Initializations
const GUIDO_HEALTH_URL = "https://runtime.guiruggiero.com/guido-health";
const GATEWAY_HEALTH_URL = "https://claudecode.guiruggiero.com/health";
const REQUEST_TIMEOUT = 8000; // 8s

// On Air sign: Pico heartbeat every minute
const PICO_HEARTBEAT_URL = "https://io.adafruit.com/api/v2/guiruggiero/feeds/pico/data/last?include=value,created_at";
const HEARTBEAT_STALE_MS = 150 * 1000; // 2.5 heartbeats
const SIGN_STATES = {
    off: "Off ⚫",
    yellow: "Yellow 🟡",
    red: "Red 🔴",
};

// Short label next to each status dot
const STATUS_LABELS = {
    up: "Up",
    down: "Down",
    checking: "Checking",
    unknown: "Unknown",
};

// DOM elements
const refreshButton = document.getElementById("refresh");
const lastRefresh = document.getElementById("last-refresh");

// Paint a card's status pill and detail line - detail can be text or a node
function setCardStatus(cardID, state, detail) {
    const card = document.getElementById(cardID);
    if (!card) return;

    const pill = card.querySelector(".status-pill");
    if (pill) {
        pill.dataset.state = state;

        const statusText = pill.querySelector(".status-text");
        if (statusText) statusText.textContent = STATUS_LABELS[state] ?? STATUS_LABELS.unknown;
    }

    const cardDetail = card.querySelector(".card-detail");
    if (cardDetail) {
        cardDetail.replaceChildren();
        if (typeof detail === "string") cardDetail.textContent = detail;
        else cardDetail.appendChild(detail);
    }
}

// Copy some text, the button confirms
async function copyText(button, text) {
    const originalText = button.textContent;

    try {
        await navigator.clipboard.writeText(text);
        button.textContent = "Copied";

    } catch {
        // Denied or insecure context - not worth Sentry
        button.textContent = "Copy failed";
    }

    setTimeout(() => {
        button.textContent = originalText;
    }, 1200);
}

// Code-styled and copyable, like a chat ID
function buildCommitDetail(commit) {
    const container = document.createDocumentFragment();
    container.appendChild(document.createTextNode("Commit "));

    const badge = document.createElement("button");
    badge.type = "button";
    badge.className = "commit-badge";
    badge.title = "Copy commit hash";
    badge.textContent = commit;
    badge.addEventListener("click", () => copyText(badge, commit));
    container.appendChild(badge);

    return container;
}

// Poll one health endpoint and update its card
async function checkService(cardID, healthURL) {
    setCardStatus(cardID, "checking", "Checking...");

    try {
        const response = await fetch(healthURL, {signal: AbortSignal.timeout(REQUEST_TIMEOUT)});

        // Reachable, but not happy
        if (!response.ok) {
            setCardStatus(cardID, "down", `Responded with HTTP ${response.status}`);
            return;
        }

        // The pill already says "up" - the commit is the useful part here
        const health = await response.json();
        setCardStatus(cardID, "up", health.commit ? buildCommitDetail(health.commit) : "Up");

    } catch (error) {
        // Down or unreachable is expected, not an error
        if (error.name === "TimeoutError") setCardStatus(cardID, "down", "No response, timed out");
        else if (error instanceof SyntaxError) setCardStatus(cardID, "down", "Reachable, but replied with a bad payload");
        else setCardStatus(cardID, "down", "Unreachable");
    }
}

// Two largest units, truncated
function formatDuration(seconds) {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor(seconds % 86400 / 3600);
    const minutes = Math.floor(seconds % 3600 / 60);
    if (days) return `${days}d ${hours}h`;
    if (hours) return `${hours}h ${minutes}m`;
    if (minutes) return `${minutes}m`;
    return `${seconds}s`;
}

// Fill one of the On Air card's stats
function setStat(card, name, text) {
    const stat = card?.querySelector(`[data-stat="${name}"]`);
    if (stat) stat.textContent = text;
}

// Read the Pico's latest heartbeat
async function checkPico() {
    const cardID = "card-onairsign";
    const card = document.getElementById(cardID);
    setCardStatus(cardID, "checking");
    setStat(card, "heartbeat", "Checking...");

    try {
        const response = await fetch(PICO_HEARTBEAT_URL, {signal: AbortSignal.timeout(REQUEST_TIMEOUT)});

        // Adafruit IO reachable, but not happy
        if (!response.ok) {
            setCardStatus(cardID, "down");
            setStat(card, "heartbeat", `Adafruit IO responded with HTTP ${response.status}`);
            return;
        }

        // The feed value is itself a JSON string: {state, uptime_s, mem_used, mem_free}
        const {value, created_at: createdAt} = await response.json();
        const heartbeat = JSON.parse(value);

        const ageSeconds = Math.max(0, Math.round((Date.now() - new Date(createdAt).getTime()) / 1000));
        setCardStatus(cardID, ageSeconds * 1000 <= HEARTBEAT_STALE_MS ? "up" : "down");
        setStat(card, "heartbeat", `${formatDuration(ageSeconds)} ago`);

        // Shown even when down - the last report helps explain what happened
        setStat(card, "state", SIGN_STATES[heartbeat.state] ?? heartbeat.state);
        setStat(card, "uptime", formatDuration(heartbeat.uptime_s));
        const {mem_used: memUsed, mem_free: memFree} = heartbeat;
        setStat(card, "memory", memUsed === undefined ? "-" : `${Math.round(memUsed / 1024)} KB (${Math.round(100 * memUsed / (memUsed + memFree))}%)`);

    } catch (error) {
        // Down or unreachable is expected, not an error
        setCardStatus(cardID, "down");
        if (error.name === "TimeoutError") setStat(card, "heartbeat", "Adafruit IO didn't respond, timed out");
        else if (error instanceof SyntaxError) setStat(card, "heartbeat", "Bad payload");
        else setStat(card, "heartbeat", "Adafruit IO unreachable");
    }
}

// Refresh every card that polls a live service
async function refreshAll() {
    if (refreshButton) refreshButton.disabled = true;

    try {
        // In parallel - independent checks
        await Promise.all([
            checkService("card-guido", GUIDO_HEALTH_URL),
            checkService("card-gateway", GATEWAY_HEALTH_URL),
            checkPico(),
        ]);

        // Timestamp so a stale dashboard is obvious
        if (lastRefresh) lastRefresh.textContent = `Checked at ${new Date().toLocaleTimeString()}`;

    } finally {
        if (refreshButton) refreshButton.disabled = false;
    }
}

// Check on load, then only on demand
refreshButton?.addEventListener("click", refreshAll);
await refreshAll();