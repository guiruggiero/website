// Imports
import {getFirestore, query, collection, where, Timestamp, orderBy, getDocs} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

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

        // textContent, never innerHTML - these are unsanitized strings typed by anonymous visitors
        const userMessage = document.createElement("p");
        userMessage.className = "turn-user";
        userMessage.textContent = turn?.user ?? "";
        turnElement.appendChild(userMessage);

        const modelMessage = document.createElement("p");
        modelMessage.className = "turn-model";
        modelMessage.textContent = turn?.model ?? "";
        turnElement.appendChild(modelMessage);

        turnsContainer.appendChild(turnElement);
    }

    return turnsContainer;
}

// Build one collapsible chat row
function buildChatRow(chat) {
    // <details> gives expand/collapse and keyboard support for free
    const row = document.createElement("details");
    row.className = "chat-row";

    const summary = document.createElement("summary");
    summary.className = "chat-summary";

    const label = document.createElement("span");
    label.className = "chat-label";
    const startedAt = chat.start?.toDate?.();
    label.textContent = [
        startedAt ? startedAt.toLocaleString() : "Unknown start",
        `${chat.turnCount ?? 0} turn${chat.turnCount === 1 ? "" : "s"}`,
        formatDuration(chat.duration),
        chat.origin ?? "unknown origin",
    ].join(" · ");
    summary.appendChild(label);

    // No delete here by design - copy this ID and Ctrl+F it in the Firebase Console instead
    const idBadge = document.createElement("code");
    idBadge.className = "chat-id";
    idBadge.textContent = chat.id;
    summary.appendChild(idBadge);

    row.appendChild(summary);
    row.appendChild(buildTurns(chat.turns));
    return row;
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

    try {
        const chats = await loadConversations(collectionName, startDate, endDate);

        if (!chats.length) {
            setStatus(`No chats in "${collectionName}" for this range`);
            return;
        }

        for (const chat of chats) chatList.appendChild(buildChatRow(chat));
        setStatus(`${chats.length} chat${chats.length === 1 ? "" : "s"} in "${collectionName}"`);

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

// Default to the last 30 days
function setDefaultRange() {
    const today = new Date();
    const rangeStart = new Date(today);
    rangeStart.setDate(rangeStart.getDate() - DEFAULT_RANGE_DAYS);

    startInput.value = toInputValue(rangeStart);
    endInput.value = toInputValue(today);
}

// Gate on sign-in, then load the default range
await initAdminAuth();
setDefaultRange();
loadButton.addEventListener("click", refreshChats);
await refreshChats();