// Imports
import {getFirestore, query, collection, where, Timestamp, orderBy, getDocs} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import DOMPurify from "https://cdn.jsdelivr.net/npm/dompurify/+esm";

// Import module dynamically
async function importModule(path) {
    if (globalThis.location?.href.includes("ngrok")) return await import(path.replace(".min.js", ".js"));
    else return await import(path);
}
const {initAdminAuth, firebaseApp} = await importModule("./admin-auth.min.js");

// Initializations
const db = getFirestore(firebaseApp);
const DEFAULT_RANGE_DAYS = 30;

// DOM elements
const collectionPicker = document.getElementById("collection-picker");
const startInput = document.getElementById("start-date");
const endInput = document.getElementById("end-date");
const loadButton = document.getElementById("load-chats");
const presetButtons = document.querySelectorAll(".preset-button");
const toggleAllButton = document.getElementById("toggle-all");
const chatList = document.getElementById("chat-list");
const statusLine = document.getElementById("chat-status");

// Show a message above the list
function setStatus(message) {
    if (statusLine) statusLine.textContent = message;
}

// Format a "YYYY-MM-DD" value for the date inputs, in local time to match how refreshChats() re-parses it
function toInputValue(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

// Format a duration in minutes as "Xm Ys"
function formatDuration(minutes) {
    // Single-turn chats are never updated, so they never get a duration
    if (typeof minutes !== "number") return "-";

    const totalSeconds = Math.round(minutes * 60);
    return `${Math.floor(totalSeconds / 60)}m ${totalSeconds % 60}s`;
}

// Query one collection for chats that started inside the range, newest first
export async function loadConversations(collectionName, startDate, endDate) {
    const chatsQuery = query(
        collection(db, collectionName),
        where("start", ">=", Timestamp.fromDate(startDate)),
        where("start", "<=", Timestamp.fromDate(endDate)),
        orderBy("start", "desc"),
    );

    const snapshot = await getDocs(chatsQuery);
    return snapshot.docs.map((snapshotDoc) => ({id: snapshotDoc.id, ...snapshotDoc.data()}));
}

// Build the numbered turn list for one chat
function buildTurns(turns) {
    const turnsContainer = document.createElement("div");
    turnsContainer.className = "turns";

    // Keys are stringified numbers, so they need a numeric sort
    const turnNumbers = Object.keys(turns ?? {})
        .map(Number)
        .filter(Number.isFinite)
        .sort((a, b) => a - b);

    if (!turnNumbers.length) {
        const empty = document.createElement("p");
        empty.className = "turn-empty";
        empty.textContent = "No turns logged";
        turnsContainer.appendChild(empty);
        return turnsContainer;
    }

    for (const turnNumber of turnNumbers) {
        const turn = turns[turnNumber];

        const turnElement = document.createElement("div");
        turnElement.className = "turn";

        const number = document.createElement("span");
        number.className = "turn-number";
        number.textContent = turnNumber;
        turnElement.appendChild(number);

        // textContent, never innerHTML - unsanitized, typed by anonymous visitors
        const userMessage = document.createElement("p");
        userMessage.className = "turn-user";
        userMessage.textContent = turn?.user ?? "";
        turnElement.appendChild(userMessage);

        // GuiPT's replies carry HTML (links, line breaks) - sanitized to the same allowlist as ui.js
        const modelMessage = document.createElement("p");
        modelMessage.className = "turn-model";
        modelMessage.innerHTML = DOMPurify.sanitize(turn?.model ?? "", {
            ALLOWED_TAGS: ["a", "b", "strong", "em", "i", "br", "p", "ul", "ol", "li"],
            ALLOWED_ATTR: ["href", "target"],
        });
        turnElement.appendChild(modelMessage);

        turnsContainer.appendChild(turnElement);
    }

    return turnsContainer;
}

// Copy a chat ID, the button confirms
async function copyChatID(button, chatID) {
    const originalText = button.textContent;

    try {
        await navigator.clipboard.writeText(chatID);
        button.textContent = "Copied";

    } catch {
        // Denied or insecure context - not worth Sentry
        button.textContent = "Copy failed";
    }

    setTimeout(() => {
        button.textContent = originalText;
    }, 1200);
}

// Build one collapsible chat row
function buildChatRow(chat) {
    // <details> gives expand/collapse and keyboard support for free
    const row = document.createElement("details");
    row.className = "chat-row";

    const summary = document.createElement("summary");
    summary.className = "chat-summary";

    // Replaces the native marker, hidden in CSS
    const chevron = document.createElement("span");
    chevron.className = "chat-chevron";
    chevron.setAttribute("aria-hidden", "true");
    const chevronIcon = document.createElement("iconify-icon");
    chevronIcon.setAttribute("icon", "ph:caret-right-bold");
    chevron.appendChild(chevronIcon);
    summary.appendChild(chevron);

    const startedAt = chat.start?.toDate?.();
    const when = document.createElement("span");
    when.className = "chat-when";
    when.textContent = startedAt
        ? startedAt.toLocaleString(undefined, {dateStyle: "medium", timeStyle: "short"})
        : "Unknown start";
    summary.appendChild(when);

    const metrics = document.createElement("span");
    metrics.className = "chat-metrics";
    metrics.textContent = `${chat.turnCount ?? 0} turn${chat.turnCount === 1 ? "" : "s"} · ${formatDuration(chat.duration)}`;
    summary.appendChild(metrics);

    // Chat ID for easy deletion in Firebase Console
    const idButton = document.createElement("button");
    idButton.type = "button";
    idButton.className = "chat-id";
    idButton.title = "Copy chat ID";
    idButton.textContent = chat.id;
    idButton.addEventListener("click", (event) => {
        // Otherwise the click toggles the row
        event.preventDefault();
        event.stopPropagation();
        copyChatID(idButton, chat.id);
    });
    summary.appendChild(idButton);

    row.appendChild(summary);
    row.appendChild(buildTurns(chat.turns));
    return row;
}

// Flip every row at once
function toggleAllRows() {
    const rows = chatList.querySelectorAll(".chat-row");
    if (!rows.length) return;

    const expanding = toggleAllButton.textContent === "Expand all";
    for (const row of rows) row.open = expanding;
    toggleAllButton.textContent = expanding ? "Collapse all" : "Expand all";
}

// Query and render the current filter selection
async function refreshChats() {
    const collectionName = collectionPicker.value;

    // Interpreted in the local timezone, which is what the date inputs show
    const startDate = new Date(`${startInput.value}T00:00:00`);
    const endDate = new Date(`${endInput.value}T23:59:59.999`);

    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
        setStatus("Pick a valid start and end date");
        return;
    }
    if (startDate > endDate) {
        setStatus("Start date is after the end date");
        return;
    }

    loadButton.disabled = true;
    setStatus("Loading...");
    chatList.replaceChildren();
    toggleAllButton.hidden = true;
    toggleAllButton.textContent = "Expand all";

    try {
        const chats = await loadConversations(collectionName, startDate, endDate);

        if (!chats.length) {
            setStatus(`No chats in "${collectionName}" for this range`);
            return;
        }

        for (const chat of chats) chatList.appendChild(buildChatRow(chat));

        const turnTotal = chats.reduce((total, chat) => total + (chat.turnCount ?? 0), 0);
        setStatus(`${chats.length} chat${chats.length === 1 ? "" : "s"} · ${turnTotal} turn${turnTotal === 1 ? "" : "s"} in "${collectionName}"`);
        toggleAllButton.hidden = false;

    } catch (error) {
        setStatus("Query failed, see Sentry for details");

        // Capture error with context
        Sentry.captureException(error, {contexts: {adminFirestore: {
            operation: "query",
            collection: collectionName,
            startDate: startDate.toISOString(),
            endDate: endDate.toISOString(),
        }}});

    } finally {
        loadButton.disabled = false;
    }
}

// Last N days, and light up the preset
function setRange(days) {
    const today = new Date();
    const rangeStart = new Date(today);
    rangeStart.setDate(rangeStart.getDate() - days);

    startInput.value = toInputValue(rangeStart);
    endInput.value = toInputValue(today);

    for (const button of presetButtons) {
        button.setAttribute("aria-pressed", String(Number(button.dataset.days) === days));
    }
}

// A manual edit no longer matches a preset
function clearPresets() {
    for (const button of presetButtons) button.setAttribute("aria-pressed", "false");
}

// Gate on sign-in, then load the default range
await initAdminAuth();
setRange(DEFAULT_RANGE_DAYS);

loadButton.addEventListener("click", refreshChats);
toggleAllButton.addEventListener("click", toggleAllRows);
collectionPicker.addEventListener("change", refreshChats);

// One click - set the range and query
for (const button of presetButtons) {
    button.addEventListener("click", async () => {
        setRange(Number(button.dataset.days));
        await refreshChats();
    });
}

// Enter in a date field loads
for (const input of [startInput, endInput]) {
    input.addEventListener("change", clearPresets);
    input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") refreshChats();
    });
}

await refreshChats();