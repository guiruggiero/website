// Initializations
const availableLangs = ["en", "pt"];
const defaultLang = "en";

// Get the user's language
const userLocale = navigator.language || navigator.userLanguage;
const userLang = userLocale.split("-")[0];
const displayLang = availableLangs.includes(userLang) ? userLang : defaultLang;

// Load and export the language data
const langData = await import(`../locales/${displayLang}.js`);
export default { // Only what's needed for index's JS-based interface
    ...langData.index,
    themeDark: langData.website.themeDark,
    themeLight: langData.website.themeLight,
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
async function translatePage() {
    // If the user's language is the default, don't translate
    if (displayLang === defaultLang) return;

    // Update the html lang attribute
    document.documentElement.lang = displayLang;
    
    // Translate eligible elements
    document.querySelectorAll("[data-i18n]").forEach((element) => { // TODO: review
        const key = element.getAttribute("data-i18n");
        const translation = getTranslation(langData, key);
        if (translation) {
            if (element.tagName === "TITLE") element.textContent = translation;
            else if (element.tagName === "IFRAME") element.title = translation;
            else if (element.tagName === "IMG") element.alt = translation;
            else if (element.tagName === "BUTTON" || element.tagName === "INPUT" || element.tagName === "DIV") element.setAttribute("aria-label", translation);
            else element.innerHTML = translation;
        }

        // Handle special leading space character if present
        if (translation.startsWith('^1')) {
            translation = ' ' + translation.substring(2);
        }

        switch (element.tagName) {
            case 'TITLE':
                element.textContent = translation;
                break;
            case 'IFRAME':
                element.title = translation;
                break;
            case 'IMG':
                element.alt = translation;
                break;
            case 'INPUT':
                // Heuristic: if the key contains "placeholder", set the placeholder attribute.
                if (key.toLowerCase().includes('placeholder')) {
                    element.placeholder = translation;
                } else {
                    element.setAttribute('aria-label', translation);
                }
                break;
            default:
                element.innerHTML = translation;
                break;
        }
    });
}

document.addEventListener("DOMContentLoaded", translatePage); // TODO: will this flash content?