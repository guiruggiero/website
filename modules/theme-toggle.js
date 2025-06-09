// modules/theme-toggle.js
(function() {
    // --- Part 1: Immediate Theme Application ---
    const preferredTheme = localStorage.getItem('themePreference') || 'dark';
    const metaTag = document.querySelector('meta[name="theme-color"]');
    const lightThemeColor = '#f4f4f4'; // Value for light theme's --header-footer-bg-color
    const darkThemeColor = '#1a1a1a';  // Value for dark theme's --header-footer-bg-color

    // Apply theme class to <html> and update meta tag
    if (preferredTheme === 'light') {
        document.documentElement.classList.add('light-theme');
        if (metaTag) {
            metaTag.setAttribute('content', lightThemeColor);
        }
    } else {
        document.documentElement.classList.remove('light-theme');
        if (metaTag) {
            metaTag.setAttribute('content', darkThemeColor);
        }
    }

    // --- Part 2: Event Listener Setup (after DOM is loaded) ---
    document.addEventListener('DOMContentLoaded', function() {
        const toggleButton = document.getElementById('theme-toggle');
        // The metaTag is already queried and available from the outer scope.
        // Re-querying lightThemeColor and darkThemeColor is not necessary as they are constants.

        if (toggleButton) {
            // Function to update button icon and ARIA label based on current theme
            function updateToggleButtonUI(isLightTheme) {
                if (isLightTheme) {
                    toggleButton.innerHTML = '<iconify-icon icon="ph:moon-bold"></iconify-icon>';
                    toggleButton.setAttribute('aria-label', 'Switch to dark theme');
                } else {
                    toggleButton.innerHTML = '<iconify-icon icon="ph:sun-bold"></iconify-icon>';
                    toggleButton.setAttribute('aria-label', 'Switch to light theme');
                }
            }

            // Set initial state of the toggle button's UI
            updateToggleButtonUI(document.documentElement.classList.contains('light-theme'));

            // Event listener for the toggle button
            toggleButton.addEventListener('click', function() {
                const isNowLight = document.documentElement.classList.toggle('light-theme');

                // Update meta tag content based on the new theme
                if (isNowLight) {
                    if (metaTag) {
                        metaTag.setAttribute('content', lightThemeColor);
                    }
                } else {
                    if (metaTag) {
                        metaTag.setAttribute('content', darkThemeColor);
                    }
                }

                // Update the button's appearance
                updateToggleButtonUI(isNowLight);

                // Save the new theme preference
                localStorage.setItem('themePreference', isNowLight ? 'light' : 'dark');
            });
        }
        // If toggleButton is not found, no error is thrown, but functionality won't be available.
    });
})();
