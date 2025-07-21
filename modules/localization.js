// Initializations
const availableLangs = ["en", "pt"];
const defaultLang = "en";

// Get the user language
const userLocale = navigator.language || navigator.userLanguage;
const userLang = userLocale.split("-")[0];
const displayLang = availableLangs.includes(userLang) ? userLang : defaultLang;

// Load and export the language data
const {default: langData} = await import(`../locales/${displayLang}.js`);
export default { // Only what's needed for index's JS-based interface
    ...langData.index,
    themeDark: langData.website.themeDark,
    themeLight: langData.website.themeLight,
    cookieConsent: langData.website.cookieConsent,
};

// Get the translation for a given key
function getTranslation(langData, key) {
    // Retrive a nested translation
    const translation = key.split(".").reduce((obj, k) => (obj ? obj[k] : null), langData);

    // Capture error with context
    if (!translation) {
        Sentry.captureException(new Error("Missing translation"), {contexts: {
            translationDetails: {
                userLocale: userLocale,
                userLang: userLang,
                displayLang: displayLang,
                key: key,
            },
        }});
    }

    return translation;
}

// Translate the page
function translatePage() {
    // Update the html lang attribute
    document.documentElement.lang = displayLang;
    
    // Translate eligible elements
    document.querySelectorAll("[data-i18n]").forEach((element) => {
        const key = element.getAttribute("data-i18n");
        const translation = getTranslation(langData, key);
        if (translation) {
            if (element.tagName === "TITLE") element.textContent = translation;
            else if (element.tagName === "IFRAME") element.title = translation;
            else if (element.tagName === "IMG") element.alt = translation;
            else if (
                element.tagName === "BUTTON" ||
                element.tagName === "INPUT" ||
                (element.tagName === "DIV" && element.getAttribute("role") === "button") // Only index's submit button
            ) element.setAttribute("aria-label", translation);
            else element.innerHTML = translation;
        }
    });

    // Make the page visible
    document.documentElement.style.visibility = "visible";
}

// Add event listener only if translation is needed
if (displayLang !== defaultLang) {
    // Check if page is already loaded
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", translatePage); // Page is still loading
    else translatePage(); // DOMContentLoaded already fired
}
// If not, make the page visible immediately
else document.documentElement.style.visibility = "visible";