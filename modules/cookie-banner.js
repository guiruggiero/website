// Import
const langData = (await import(globalThis.location.href.includes("ngrok") ? "./localization.js" : "./localization.min.js")).default;

function showCookieConsentBanner() {
    // Create banner
    const cookieConsent = document.createElement("div");
    cookieConsent.className = "cookie-consent";
    cookieConsent.innerHTML = langData.cookieConsent;

    // Dismiss banner on button press and save consent
    cookieConsent.querySelector("button").addEventListener("pointerup", () => {
        localStorage.setItem("cookieConsent", "true");
        cookieConsent.classList.remove("show");
    });

    // Show banner
    document.body.appendChild(cookieConsent);
    cookieConsent.classList.add("show");
}

// Check for consent
const hasConsent = localStorage.getItem("cookieConsent");
if (!hasConsent) showCookieConsentBanner(); // New banner if no consent given