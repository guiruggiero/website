// Initializations
const availableLangs = ["en", "pt"];
const defaultLang = "en";

// Get the user's language
const userLocale = navigator.language || navigator.userLanguage;
const userLang = userLocale.split("-")[0];
const displayLang = availableLangs.includes(userLang) ? userLang : defaultLang;

// Get the translation for a given key
function getTranslation(langData, key) {
    const translation = key.split(".").reduce((obj, k) => (obj ? obj[k] : null), langData); // TODO: correct? Understand better
    if (!translation) console.warn(`Missing translation for key: ${key}`); // TODO: throw error with Sentry
    return translation;
}

// Translate the page
async function translatePage() {
    // If the user's language is the default, don't translate
    if (displayLang === defaultLang) return;
    
    // Load the language data
    const langData = await import(`../locales/${displayLang}.js`);
    
    // Update the html lang attribute
    document.documentElement.lang = displayLang; // TODO: right way of doing it? No reference to HTML tag
    
    document.querySelectorAll("[data-i18n]").forEach((element) => { // TODO: doesn't work for "data-i18n-"
        const key = element.getAttribute("data-i18n");
        const translation = getTranslation(langData, key);
        if (translation) element.innerHTML = translation;
    });
}

// Initialize the localization when the DOM is ready
document.addEventListener("DOMContentLoaded", translatePage);