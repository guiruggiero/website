// Initializations
const GUIDO_HEALTH_URL = "https://runtime.guiruggiero.com/guido-health";
const GATEWAY_HEALTH_URL = "https://claudecode.guiruggiero.com/health";
const REQUEST_TIMEOUT = 8000; // 8s

// Paint a card's status dot and detail line
function setCardStatus(cardID, state, detail) {
    const card = document.getElementById(cardID);
    if (!card) return;

    card.querySelector(".status-dot")?.setAttribute("data-state", state);

    const cardDetail = card.querySelector(".card-detail");
    if (cardDetail) cardDetail.textContent = detail;
}

// Check GuiDo's health endpoint and update its card
async function checkGuiDo() {
    setCardStatus("card-guido", "checking", "Checking...");

    try {
        const response = await fetch(GUIDO_HEALTH_URL, {signal: AbortSignal.timeout(REQUEST_TIMEOUT)});

        // Reachable, but not happy
        if (!response.ok) {
            setCardStatus("card-guido", "down", `Responded with HTTP ${response.status}`);
            return;
        }

        const health = await response.json();
        setCardStatus("card-guido", "up", health.commit ? `Up - commit ${health.commit}` : "Up");

    } catch (error) {
        // Down or unreachable is expected, not an error
        if (error.name === "TimeoutError") setCardStatus("card-guido", "down", "No response, timed out");
        else if (error instanceof SyntaxError) setCardStatus("card-guido", "down", "Reachable, but replied with a bad payload");
        else setCardStatus("card-guido", "down", "Unreachable");
    }
}

// Check claudeCodeGateway's health endpoint and update its card
async function checkClaudeCodeGateway() {
    setCardStatus("card-gateway", "checking", "Checking...");

    try {
        const response = await fetch(GATEWAY_HEALTH_URL, {signal: AbortSignal.timeout(REQUEST_TIMEOUT)});

        // Reachable, but not happy
        if (!response.ok) {
            setCardStatus("card-gateway", "down", `Responded with HTTP ${response.status}`);
            return;
        }

        const health = await response.json();
        setCardStatus("card-gateway", "up", health.commit ? `Up - commit ${health.commit}` : "Up");

    } catch (error) {
        // Down or unreachable is expected, not an error
        if (error.name === "TimeoutError") setCardStatus("card-gateway", "down", "No response, timed out");
        else if (error instanceof SyntaxError) setCardStatus("card-gateway", "down", "Reachable, but replied with a bad payload");
        else setCardStatus("card-gateway", "down", "Unreachable");
    }
}

// Refresh every card that polls a live service
async function refreshAll() {
    await checkGuiDo();
    await checkClaudeCodeGateway();

    // Timestamp so a stale dashboard is obvious
    const lastRefresh = document.getElementById("last-refresh");
    if (lastRefresh) {
        lastRefresh.textContent = `Last checked at ${new Date().toLocaleTimeString()}`;
    }
}

// Check once on load - reload the page for a fresh read
await refreshAll();