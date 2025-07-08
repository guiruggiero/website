let preferredTheme = localStorage.getItem("themePreference") || "dark";
const metaTag = document.querySelector("meta[name='theme-color']");
const darkThemeColor = "#1a1a1a"; // --primary-bg-color
const lightThemeColor = "#f4f4f4"; // --primary-bg-color

// Set initial theme based on saved preference
if (preferredTheme === "light") {
    document.documentElement.classList.add("light-theme");
    metaTag.setAttribute("content", lightThemeColor);
}

// Update icons and ARIA label
function updateIcons(theme) {
    const GRlogo = document.querySelector("#logo picture");
    const GRicon = document.querySelector(".header-container picture");
    const toggleButton = document.getElementById("theme-toggle");
    
    // Home logo
    if (GRlogo) {
        const GRlogoSource = GRlogo.querySelector("source");
        const GRlogoImg = GRlogo.querySelector("img");

        if (theme === "light") {
            GRlogoSource.setAttribute("srcset", "images/gr-logo-dark.webp");
            GRlogoImg.setAttribute("src", "images/gr-logo-dark.png");
        } else {
            GRlogoSource.setAttribute("srcset", "images/gr-logo-light.webp");
            GRlogoImg.setAttribute("src", "images/gr-logo-light.png");
        }
    }

    // Header
    if (GRicon && toggleButton) {
        const GRiconSource = GRicon.querySelector("source");
        const GRiconImg = GRicon.querySelector("img");
        
        if (theme === "light") {
            GRiconSource.setAttribute("srcset", "images/gr-logo-dark.webp");
            GRiconImg.setAttribute("src", "images/gr-logo-dark.png");
            toggleButton.innerHTML = "<iconify-icon icon='ph:moon-bold'></iconify-icon>";
            toggleButton.setAttribute("aria-label", "Switch to dark theme");
        } else {
            GRiconSource.setAttribute("srcset", "images/gr-logo-light.webp");
            GRiconImg.setAttribute("src", "images/gr-logo-light.png");
            toggleButton.innerHTML = "<iconify-icon icon='ph:sun-bold'></iconify-icon>";
            toggleButton.setAttribute("aria-label", "Switch to light theme");
        }
    }
}

// Update icons immediately if light theme is preferred
if (preferredTheme === "light") {
    // Try to update immediately if elements exist
    updateIcons(preferredTheme);
    
    // Set up an observer in case elements aren't ready yet
    if (!document.querySelector("header picture")) {
        const observer = new MutationObserver(() => {
            if (document.querySelector("header picture")) {
                updateIcons(preferredTheme);
                observer.disconnect();
            }
        });
        observer.observe(document.documentElement, {childList: true, subtree: true});
    }
}

document.addEventListener("DOMContentLoaded", () => {
    const toggleButton = document.getElementById("theme-toggle");

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
});