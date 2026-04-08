// Initialization
const cloudFunctionURL = "https://us-central1-guiruggiero.cloudfunctions.net/guiwise";

// DOM refs
const descInput = document.getElementById("description");
const amountInput = document.getElementById("amount");
const submitBtn = document.getElementById("submitBtn");
const toast = document.getElementById("toast");
const toastMsg = document.getElementById("toastMsg");
const toastIcon = document.getElementById("toastIcon");

// Helpers
let toastTimer;
function showToast(message, type = "success") {
    clearTimeout(toastTimer);
    toast.className = `toast ${type}`;
    toastIcon.textContent = type === "success" ? "✓" : "✕";
    toastMsg.textContent = message;

    // Force reflow to re-trigger animation before adding visible class
    toast.classList.remove("visible");
    void toast.offsetWidth;
    toast.classList.add("visible");

    toastTimer = setTimeout(() => toast.classList.remove("visible"), 4000);
}

function setLoading(loading) {
    submitBtn.disabled = loading;
    submitBtn.classList.toggle("loading", loading);
}

// Submit handler
submitBtn.addEventListener("click", async () => {
    const description = descInput.value.trim();
    const amount = parseFloat(amountInput.value);

    if (!description) { showToast("Please enter a description", "error"); descInput.focus(); return; }
    if (!amount || amount <= 0) { showToast("Please enter a valid amount", "error"); amountInput.focus(); return; }

    setLoading(true);

    try {
        const response = await fetch(cloudFunctionURL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ description, amount }),
        });

        const data = await response.json();

        if (!response.ok) {
            const msg = data?.errors?.base?.[0] || data?.error || `Error ${response.status}`;
            showToast(msg, "error");
            return;
        }

        const created = data?.expenses?.[0];
        const name = created?.description || description;
        const cost = created?.cost || amount.toFixed(2);
        showToast(`"${name}" — $${cost} added`);
        descInput.value = "";
        amountInput.value = "";
        descInput.focus();
    } catch (error) {
        showToast("Something went wrong, please try again", "error");
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