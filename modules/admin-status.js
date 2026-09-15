// Initializations
const GUIDO_HEALTH_URL = "https://runtime.guiruggiero.com/guido-health";
const GATEWAY_HEALTH_URL = "https://claudecode.guiruggiero.com/health";
const REQUEST_TIMEOUT = 8000; // 8s

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

// Refresh every card that polls a live service
async function refreshAll() {
    if (refreshButton) refreshButton.disabled = true;

    try {
        // In parallel - independent checks
        await Promise.all([
            checkService("card-guido", GUIDO_HEALTH_URL),
            checkService("card-gateway", GATEWAY_HEALTH_URL),
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