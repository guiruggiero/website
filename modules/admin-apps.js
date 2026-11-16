// Last run of the weekly app update, from GitHub's public API (no key, the repo is public)
const RUNS_URL = "https://api.github.com/repos/guiruggiero/website/actions/workflows/apps-update.yml/runs?per_page=1";
const REQUEST_TIMEOUT = 8000; // 8s

// DOM elements
const refreshButton = document.getElementById("refresh");
const updateText = document.getElementById("last-update");
const updateLink = document.getElementById("update-link");
const updateIcon = updateLink.querySelector("iconify-icon");

// Icon per state of the last run
const STATE_ICONS = {
    up: "ph:check-circle-bold",
    down: "ph:x-circle-bold",
    checking: "ph:circle-notch-bold",
    unknown: "ph:question-bold",
};

const relativeTime = new Intl.RelativeTimeFormat("en", {numeric: "auto"});

function timeAgo(date) {
    const minutes = Math.round((date - Date.now()) / 60000);
    if (Math.abs(minutes) < 60) return relativeTime.format(minutes, "minute");

    const hours = Math.round(minutes / 60);
    if (Math.abs(hours) < 24) return relativeTime.format(hours, "hour");

    return relativeTime.format(Math.round(hours / 24), "day");
}

function paint(text, state, href) {
    updateText.textContent = text;
    updateLink.dataset.state = state;
    updateIcon.setAttribute("icon", STATE_ICONS[state]);
    if (href) updateLink.href = href;
    else updateLink.removeAttribute("href");
}

async function checkUpdate() {
    refreshButton.disabled = true;
    paint("Checking…", "checking");

    try {
        const response = await fetch(RUNS_URL, {signal: AbortSignal.timeout(REQUEST_TIMEOUT)});
        if (!response.ok) throw new Error(`GitHub answered ${response.status}`);

        const {workflow_runs: [run]} = await response.json();
        if (!run) {
            paint("No update yet", "unknown");
            return;
        }

        if (run.status !== "completed") paint("Update running", "checking", run.html_url);
        else if (run.conclusion === "success") paint(`Updated ${timeAgo(new Date(run.updated_at))}`, "up", run.html_url);
        else paint(`Updated ${timeAgo(new Date(run.updated_at))}`, "down", run.html_url);

    } catch (error) {
        paint("Update status unavailable", "unknown");

        // Capture error with context
        Sentry.captureException(error, {contexts: {appsUpdateStatus: {
            operation: "checkUpdate",
            url: RUNS_URL,
        }}});

    } finally {
        refreshButton.disabled = false;
    }
}

refreshButton.addEventListener("click", checkUpdate);
checkUpdate();