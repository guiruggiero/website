// Initialization
const cloudFunctionURL = "https://us-central1-guiruggiero.cloudfunctions.net/guiwise";

// DOM refs
const descInput = document.getElementById("description");
const amountInput = document.getElementById("amount");
const splitSearch = document.getElementById("splitSearch");
const splitChips = document.getElementById("splitChips");
const splitDropdown = document.getElementById("splitDropdown");
const unevenToggleWrapper = document.getElementById("unevenToggleWrapper");
const unevenToggle = document.getElementById("unevenToggle");
const unevenField = document.getElementById("unevenField");
const unevenRows = document.getElementById("unevenRows");
const unevenRemaining = document.getElementById("unevenRemaining");
const submitBtn = document.getElementById("submitBtn");
const toast = document.getElementById("toast");
const toastMsg = document.getElementById("toastMsg");
const toastIcon = document.getElementById("toastIcon");

// Picker state, populated from Guiddleware (via Guiwise) on load
let friends = [];
let groups = [];
const selectedFriendIds = new Set();
let selectedGroupId = null;

// Helpers
let toastTimer;
function showToast(message, type = "success") {
    clearTimeout(toastTimer);
    toast.className = `toast ${type}`;
    toastIcon.textContent = type === "success" ? "✓" : "✕";
    toastMsg.textContent = message;

    // Force reflow to re-trigger animation before adding visible class
    toast.classList.remove("visible");
    toast.getBoundingClientRect();
    toast.classList.add("visible");

    toastTimer = setTimeout(() => toast.classList.remove("visible"), 4000);
}

function setLoading(loading) {
    submitBtn.disabled = loading;
    submitBtn.classList.toggle("loading", loading);
}

// The registry only reliably resolves first names, so that's what's sent
function firstNameOf(friend) {
    return friend.name.split(" ")[0].toLowerCase();
}

// Fetch friends and groups to populate the multi-select (best-effort: a
// failure here just means the field stays empty, solo expenses still work)
async function loadPickerData() {
    try {
        const [friendsRes, groupsRes] = await Promise.all([
            fetch(`${cloudFunctionURL}/friends`),
            fetch(`${cloudFunctionURL}/groups`),
        ]);
        const friendsData = await friendsRes.json();
        const groupsData = await groupsRes.json();

        if (friendsRes.ok) friends = friendsData.friends ?? [];
        if (groupsRes.ok) groups = groupsData.groups ?? [];
    } catch (error) {
        console.error("Failed to load friends/groups:", error);
        Sentry.captureException(error);
    }
}

// Renders the selected chips inside the multi-select control
function renderChips() {
    splitChips.innerHTML = "";

    if (selectedGroupId) {
        const group = groups.find((g) => g.id === selectedGroupId);
        if (group) splitChips.appendChild(buildChip(group.name, true, () => {
            selectedGroupId = null;
            onSelectionChange();
        }));
    }

    for (const id of selectedFriendIds) {
        const friend = friends.find((f) => f.id === id);
        if (!friend) continue;
        splitChips.appendChild(buildChip(friend.name, false, () => {
            selectedFriendIds.delete(id);
            onSelectionChange();
        }));
    }
}

function buildChip(label, isGroup, onRemove) {
    const chip = document.createElement("span");
    chip.className = isGroup ? "chip chip-group" : "chip";
    chip.innerHTML = `<span>${label}</span>`;

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.setAttribute("aria-label", `Remove ${label}`);
    removeBtn.textContent = "✕";
    removeBtn.addEventListener("click", onRemove);
    chip.appendChild(removeBtn);

    return chip;
}

// Renders the filtered dropdown list under the search input
function renderDropdown() {
    const query = splitSearch.value.trim().toLowerCase();
    splitDropdown.innerHTML = "";

    // Groups aren't offered once specific friends are selected, and vice
    // versa — the API only supports one or the other in a single expense
    const showGroups = selectedFriendIds.size === 0;
    const showFriends = !selectedGroupId;

    const matchedGroups = showGroups ? groups.filter((g) =>
        g.name.toLowerCase().includes(query)) : [];
    const matchedFriends = showFriends ? friends.filter((f) =>
        !selectedFriendIds.has(f.id) &&
        (f.name.toLowerCase().includes(query) ||
            f.nickname?.toLowerCase().includes(query))) : [];

    if (matchedGroups.length === 0 && matchedFriends.length === 0) {
        const empty = document.createElement("div");
        empty.className = "dropdown-empty";
        empty.textContent = friends.length === 0 && groups.length === 0 ?
            "Couldn't load friends or groups" : "No matches";
        splitDropdown.appendChild(empty);
        splitDropdown.hidden = false;
        return;
    }

    if (matchedGroups.length > 0) {
        splitDropdown.appendChild(buildSectionLabel("Groups"));
        for (const group of matchedGroups) {
            splitDropdown.appendChild(buildDropdownItem("👥", group.name, () => {
                selectedGroupId = group.id;
                selectedFriendIds.clear();
                onSelectionChange();
            }));
        }
    }

    if (matchedFriends.length > 0) {
        splitDropdown.appendChild(buildSectionLabel("Friends"));
        for (const friend of matchedFriends) {
            splitDropdown.appendChild(buildDropdownItem("👤", friend.name, () => {
                selectedFriendIds.add(friend.id);
                selectedGroupId = null;
                onSelectionChange();
            }));
        }
    }

    splitDropdown.hidden = false;
}

function buildSectionLabel(text) {
    const label = document.createElement("div");
    label.className = "dropdown-section-label";
    label.textContent = text;
    return label;
}

function buildDropdownItem(icon, label, onSelect) {
    const item = document.createElement("div");
    item.className = "dropdown-item";
    item.innerHTML = `<span class="item-icon">${icon}</span><span>${label}</span>`;
    item.addEventListener("click", () => {
        onSelect();
        splitSearch.value = "";
        splitSearch.focus();
    });
    return item;
}

// Re-renders everything that depends on the current selection
function onSelectionChange() {
    renderChips();
    renderDropdown();
    updateUnevenVisibility();
}

// The uneven-split toggle only applies to specific friends, not a group,
// since group membership isn't known client-side
function updateUnevenVisibility() {
    const canSplitUnevenly = selectedFriendIds.size > 0;
    unevenToggleWrapper.hidden = !canSplitUnevenly;

    if (!canSplitUnevenly && unevenToggle.checked) {
        unevenToggle.checked = false;
    }
    unevenField.hidden = !unevenToggle.checked || !canSplitUnevenly;

    if (unevenToggle.checked && canSplitUnevenly) buildUnevenRows();
}

// Builds one editable amount row per participant (Gui + selected friends),
// defaulting to an equal split with the remainder assigned to Gui's row
function buildUnevenRows() {
    unevenRows.innerHTML = "";

    const participants = [
        {id: "gui", name: "You"},
        ...[...selectedFriendIds].map((id) => {
            const friend = friends.find((f) => f.id === id);
            return {id: friend ? firstNameOf(friend) : id, name: friend?.name ?? id};
        }),
    ];

    const total = Number.parseFloat(amountInput.value) || 0;
    const share = Math.floor((total / participants.length) * 100) / 100;
    const remainder = Math.round((total - share * participants.length) * 100) / 100;

    participants.forEach((participant, i) => {
        const defaultAmount = i === 0 ? share + remainder : share;

        const row = document.createElement("div");
        row.className = "uneven-row";
        row.innerHTML = `
            <span class="uneven-name">${participant.name}</span>
            <div class="amount-wrapper">
                <span class="amount-prefix">$</span>
                <input type="number" min="0" step="0.01" value="${defaultAmount.toFixed(2)}"
                    data-participant="${participant.id}" data-name="${participant.name}">
            </div>
        `;
        unevenRows.appendChild(row);
    });

    unevenRows.querySelectorAll("input").forEach((input) => {
        input.addEventListener("input", updateUnevenRemaining);
    });
    updateUnevenRemaining();
}

function updateUnevenRemaining() {
    const total = Number.parseFloat(amountInput.value) || 0;
    const entered = [...unevenRows.querySelectorAll("input")]
        .reduce((sum, input) => sum + (Number.parseFloat(input.value) || 0), 0);
    const remaining = Math.round((total - entered) * 100) / 100;

    const balanced = Math.abs(remaining) < 0.01;
    unevenRemaining.classList.toggle("balanced", balanced);
    unevenRemaining.classList.toggle("unbalanced", !balanced);
    unevenRemaining.textContent = balanced ?
        "Amounts add up ✓" : `$${remaining.toFixed(2)} remaining`;
}

// Split-with input events
splitSearch.addEventListener("focus", renderDropdown);
splitSearch.addEventListener("input", renderDropdown);
document.addEventListener("click", (e) => {
    if (!document.getElementById("splitMultiselect").contains(e.target)) {
        splitDropdown.hidden = true;
    }
});
unevenToggle.addEventListener("change", updateUnevenVisibility);
amountInput.addEventListener("input", () => {
    if (unevenToggle.checked && !unevenField.hidden) buildUnevenRows();
});

// Submit handler
submitBtn.addEventListener("click", async () => {
    const description = descInput.value.trim();
    const amount = Number.parseFloat(amountInput.value);

    if (!description) {
        showToast("Please enter a description", "error");
        descInput.focus();
        return;
    }
    if (!amount || amount <= 0) {
        showToast("Please enter a valid amount", "error");
        amountInput.focus();
        return;
    }

    const payload = {description, amount, currency: "USD"};

    if (selectedGroupId) {
        payload.groupId = selectedGroupId;
    } else if (selectedFriendIds.size > 0 && unevenToggle.checked) {
        const owedAmounts = [...unevenRows.querySelectorAll("input")].map((input) => ({
            name: input.dataset.participant,
            owed: Number.parseFloat(input.value) || 0,
        }));
        const sum = owedAmounts.reduce((s, o) => s + o.owed, 0);
        if (Math.abs(sum - amount) > 0.01) {
            showToast("Custom amounts must add up to the total", "error");
            return;
        }
        payload.owedAmounts = owedAmounts;
    } else if (selectedFriendIds.size > 0) {
        payload.splitWith = [...selectedFriendIds].map((id) => {
            const friend = friends.find((f) => f.id === id);
            return friend ? firstNameOf(friend) : id;
        });
    }

    setLoading(true);

    try {
        const response = await fetch(cloudFunctionURL, {
            method: "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify(payload),
        });

        const data = await response.json();

        if (!response.ok) {
            const msg = data?.error || `Error ${response.status}`;
            showToast(msg, "error");
            return;
        }

        const created = data?.expense;
        const name = created?.description || description;
        const cost = created?.cost || amount.toFixed(2);

        if (data.fallback === "solo") {
            const reason = data.issues?.join("; ") ||
                `couldn't find: ${data.unknownNames?.join(", ")}`;
            showToast(`"${name}" — $${cost} added solo (${reason})`, "error");
        } else {
            showToast(`"${name}" — $${cost} added`);
        }

        descInput.value = "";
        amountInput.value = "";
        selectedFriendIds.clear();
        selectedGroupId = null;
        unevenToggle.checked = false;
        onSelectionChange();
        descInput.focus();
    } catch (error) {
        showToast("Something went wrong, please try again", "error");
        Sentry.captureException(error, {contexts: {description, amount}});
        console.error("Failed to create expense:", error);
    } finally {
        setLoading(false);
    }
});

[descInput, amountInput].forEach(el => {
    el.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !submitBtn.disabled) submitBtn.click();
    });
});

descInput.focus();
loadPickerData();
