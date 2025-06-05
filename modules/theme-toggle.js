// modules/theme-toggle.js
const toggleButton = document.getElementById('theme-toggle');
const metaThemeColor = document.querySelector('meta[name="theme-color"]');

const darkThemeColor = '#1a1a1a'; // Hardcoded, matches CSS variable for dark header/footer
const lightThemeColor = '#f4f4f4'; // Hardcoded, matches CSS variable for light header/footer

// Function to update button icon, aria-label, and meta theme color
function updateThemeUI(isLightTheme) {
    if (!toggleButton) return; // Do nothing if button isn't present

    if (isLightTheme) {
        toggleButton.innerHTML = '<iconify-icon icon="ph:moon-bold"></iconify-icon>';
        toggleButton.setAttribute('aria-label', 'Switch to dark theme');
        if (metaThemeColor) metaThemeColor.setAttribute('content', lightThemeColor);
    } else {
        toggleButton.innerHTML = '<iconify-icon icon="ph:sun-bold"></iconify-icon>';
        toggleButton.setAttribute('aria-label', 'Switch to light theme');
        if (metaThemeColor) metaThemeColor.setAttribute('content', darkThemeColor);
    }
}

// Function to handle the theme toggle click
function handleThemeToggle() {
    const isNowLight = document.documentElement.classList.toggle('light-theme');
    // classList.toggle returns true if the class is added (i.e., now present),
    // and false if it is removed (i.e., now absent).

    updateThemeUI(isNowLight);
    localStorage.setItem('themePreference', isNowLight ? 'light' : 'dark');
}

// Initialization function to be called from main.js
export function initThemeToggle() {
    if (toggleButton) {
        // Set initial button icon and meta theme color based on theme applied by inline script
        const initialIsLight = document.documentElement.classList.contains('light-theme');
        updateThemeUI(initialIsLight); // This also updates meta tag

        // Add click listener
        toggleButton.addEventListener('click', handleThemeToggle);
    } else {
        // If there's no toggle button, we still might want to ensure the meta tag is correct,
        // though the inline script should have already handled this.
        // This call ensures it if this module were loaded on a page without a button
        // but with a meta tag and a theme preference.
        const initialIsLight = document.documentElement.classList.contains('light-theme');
        if (metaThemeColor) { // Only update meta if it exists
             if (initialIsLight) {
                metaThemeColor.setAttribute('content', lightThemeColor);
             } else {
                metaThemeColor.setAttribute('content', darkThemeColor);
             }
        }
    }
}
