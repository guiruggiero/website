class CookieConsent {
    constructor() {
        this.cookieConsent = document.createElement("div");
        this.cookieConsent.className = "cookie-consent";
        this.cookieConsent.innerHTML = `
            <p>This site uses butter cookies from Google to analyze traffic.</p>
            <button>OK, got it! 🍪</button>
        `;
        
        this.cookieConsent.querySelector("button").addEventListener("click", () => this.acceptCookies());
        
        document.body.appendChild(this.cookieConsent);
        this.checkCookieConsent();
    }

    checkCookieConsent() {
        const hasConsent = localStorage.getItem("cookieConsent");
        if (!hasConsent) {
            this.cookieConsent.classList.add("show");
        }
    }

    acceptCookies() {
        localStorage.setItem("cookieConsent", "true");
        this.cookieConsent.classList.remove("show");
    }
}

document.addEventListener("DOMContentLoaded", () => {
    new CookieConsent();
})