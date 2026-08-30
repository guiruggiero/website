// Initializations
const availableLangs = ["en", "pt"];
const defaultLang = "en";

// Get the user language
const userLocale = navigator.language || navigator.userLanguage;
const userLang = userLocale.split("-")[0];
const displayLang = availableLangs.includes(userLang) ? userLang : defaultLang;

// Fallback, make page visible even if locale import or translation fails
const visibilityFallback = setTimeout(
    () => document.documentElement.style.visibility = "visible",
    3000,
);

// Get the translation for a given key
function getTranslation(rawLangData, key) {
    // Retrive a nested translation
    const translation = key.split(".").reduce((obj, k) => (obj?.[k]), rawLangData);

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
function translatePage(rawLangData) {
    clearTimeout(visibilityFallback);

    // Update the html lang attribute
    document.documentElement.lang = displayLang;

    // Translate eligible elements
    document.querySelectorAll("[data-i18n]").forEach((element) => {
        const key = element.dataset.i18n;
        const translation = getTranslation(rawLangData, key);
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

// Load and expose the language data via an async function
let langDataPromise = null;
export function getLangData() {
    if (!langDataPromise) {
        langDataPromise = (async () => {
            const {default: rawLangData} = await import(`../locales/${displayLang}.js`);

            // Add event listener only if translation is needed
            if (displayLang !== defaultLang) {
                if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => translatePage(rawLangData)); // Page is still loading
                else translatePage(rawLangData); // DOMContentLoaded already fired
            }
            // If not, make the page visible immediately
            else {
                clearTimeout(visibilityFallback);
                document.documentElement.style.visibility = "visible";
            }

            return { // Only what's needed for index's JS-based interface
                ...rawLangData.index,
                themeDark: rawLangData.website.themeDark,
                themeLight: rawLangData.website.themeLight,
                cookieConsent: rawLangData.website.cookieConsent,
            };
        })();
    }
    return langDataPromise;
}
