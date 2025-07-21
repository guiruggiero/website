// Import
const langData = (await import(window.location.href.includes("ngrok") ? "./localization.js" : "./localization.min.js")).default;

// Initializations
let preferredTheme = localStorage.getItem("themePreference") || "dark";
const metaTag = document.querySelector("meta[name='theme-color']");
const darkThemeColor = "#1a1a1a"; // CSS --primary-bg-color
const lightThemeColor = "#f4f4f4"; // CSS --primary-bg-color

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
    metaTag.setAttribute("content", lightThemeColor);

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

        // Toggle the theme
        if (document.documentElement.classList.toggle("light-theme")) {
            preferredTheme = "light";

            // Update theme and icons
            metaTag.setAttribute("content", lightThemeColor);
            updateIcons("light");

            // Save the new theme preference
            localStorage.setItem("themePreference", "light");

        } else {
            preferredTheme = "dark";

            // Update theme and icons
            metaTag.setAttribute("content", darkThemeColor);
            updateIcons("dark");

            // Save the new theme preference
            localStorage.setItem("themePreference", "dark");
        }
    });
}

// Check if page is already loaded
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", setupThemeToggle); // Page is still loading
else setupThemeToggle(); // DOMContentLoaded already fired