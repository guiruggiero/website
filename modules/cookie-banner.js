class CookieConsent {
    constructor() {
        // Create banner
        this.cookieConsent = document.createElement("div");
        this.cookieConsent.className = "cookie-consent";
        this.cookieConsent.innerHTML = `
            <p>This site uses butter cookies from Google to analyze traffic.</p>
            <button>OK, got it! 🍪</button>
        `;
        
        // Dismiss banner on button press and save consent
        this.cookieConsent.querySelector("button").addEventListener("pointerup", () => {
            localStorage.setItem("cookieConsent", "true");
            this.cookieConsent.classList.remove("show");
        });
        
        // Show banner
        document.body.appendChild(this.cookieConsent);
        this.cookieConsent.classList.add("show");
    }
}

// Check for consent
const hasConsent = localStorage.getItem("cookieConsent");
if (!hasConsent) {
    new CookieConsent(); // New banner if no consent given
}