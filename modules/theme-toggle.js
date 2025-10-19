// Import
const langData = (await import(globalThis.location.href.includes("ngrok") ? "./localization.js" : "./localization.min.js")).default;

// Initialization
let preferredTheme = localStorage.getItem("themePreference") || "dark";

// Update icons and ARIA label
function updateIcons(theme) {
    // Home logo
    const GRlogo = document.querySelector("#logo picture");
    const GRlogoSource = GRlogo?.querySelector("source");
    const GRlogoImg = GRlogo?.querySelector("img");
    
    // Header logo and theme toggle icons
    const GRicon = document.querySelector(".header-container picture");
    const GRiconSource = GRicon?.querySelector("source");
    const GRiconImg = GRicon?.querySelector("img");
    const toggleButton = document.getElementById("theme-toggle");
    
    if (theme === "light") {
        GRlogoSource?.setAttribute("srcset", "images/gr-logo-dark.webp");
        GRlogoImg?.setAttribute("src", "images/gr-logo-dark.png");

        GRiconSource?.setAttribute("srcset", "images/gr-logo-dark.webp");
        GRiconImg?.setAttribute("src", "images/gr-logo-dark.png");
        if (toggleButton) toggleButton.innerHTML = "<iconify-icon icon='ph:moon-bold'></iconify-icon>";
        toggleButton?.setAttribute("aria-label", langData.themeLight);

    } else {
        GRlogoSource?.setAttribute("srcset", "images/gr-logo-light.webp");
        GRlogoImg?.setAttribute("src", "images/gr-logo-light.png");

        GRiconSource?.setAttribute("srcset", "images/gr-logo-light.webp");
        GRiconImg?.setAttribute("src", "images/gr-logo-light.png");
        if (toggleButton) toggleButton.innerHTML = "<iconify-icon icon='ph:sun-bold'></iconify-icon>";
        toggleButton?.setAttribute("aria-label", langData.themeDark);
    }
}

// Update theme and icons immediately if light theme is preferred
if (preferredTheme === "light") {
    // Update theme
    document.documentElement.classList.add("light-theme");

    // Try to update icons if elements exist
    updateIcons(preferredTheme);
    
    // Set up an observer in case elements aren't ready yet
    if (!document.querySelector(".header-container picture") || !document.getElementById("theme-toggle")) {
        const observer = new MutationObserver(() => {
            if (document.querySelector(".header-container picture") && document.getElementById("theme-toggle")) {
                updateIcons(preferredTheme);
                observer.disconnect();
            }
        });
        observer.observe(document.documentElement, {childList: true, subtree: true});
    }
}

function setupThemeToggle() {
    const toggleButton = document.getElementById("theme-toggle");
    updateIcons(preferredTheme);

    // Event listener for the toggle button
    toggleButton.addEventListener("pointerup", () => {
        // Toggle the theme - true if added, false if removed
        if (document.documentElement.classList.toggle("light-theme")) preferredTheme = "light";
        else preferredTheme = "dark";

        // Update icons and save the new theme preference
        updateIcons(preferredTheme);
        localStorage.setItem("themePreference", preferredTheme);
    });
}

// Check if page is already loaded
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", setupThemeToggle); // Page is still loading
else setupThemeToggle(); // DOMContentLoaded already fired