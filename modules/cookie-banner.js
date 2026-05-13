// Import
const langData = (await import(globalThis.location?.href.includes("ngrok") ? "./localization.js" : "./localization.min.js")).default;

function showCookieConsentBanner() {
    // Create banner
    const cookieConsent = document.createElement("div");
    cookieConsent.className = "cookie-consent";
    cookieConsent.innerHTML = langData.cookieConsent;

    // Dismiss banner on button press and save consent
    cookieConsent.querySelector("button").addEventListener("pointerup", () => {
        try {
            localStorage.setItem("cookieConsent", "true");
        } catch {
            // localStorage blocked, consent not persisted
        }
        cookieConsent.classList.remove("show");
    });

    // Show banner
    document.body.appendChild(cookieConsent);
    cookieConsent.classList.add("show");
}

// Check for consent
let hasConsent = false;
try {
    hasConsent = localStorage.getItem("cookieConsent");
} catch {
    // localStorage blocked, treat as no consent
}
if (!hasConsent) showCookieConsentBanner(); // New banner if no consent given