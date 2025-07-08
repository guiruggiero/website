function showCookieConsentBanner() {
    // Create banner
    const cookieConsent = document.createElement("div");
    cookieConsent.className = "cookie-consent";
    cookieConsent.innerHTML = `
        <p>This site uses butter cookies from Google to analyze traffic.</p>
        <button>OK, got it! 🍪</button>
    `;

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