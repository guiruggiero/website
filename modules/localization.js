/**
 * @module localization
 * @description This module handles the localization of the website. It detects the user's browser language and loads the appropriate language file. It also provides a function to translate the page.
 * @version 1.0.0
 * @author Gui Ruggiero
 * @copyright 2024 Gui Ruggiero
 */

// Available languages
const availableLanguages = ["en", "pt"];

// Default language
const defaultLanguage = "en";

/**
 * Get the user's language
 * @returns {string} The user's language
 * @example
 * const userLanguage = getUserLanguage(); // "en"
 */
function getUserLanguage() {
	const userLang = navigator.language || navigator.userLanguage;
	const language = userLang.split("-")[0];
	return availableLanguages.includes(language) ? language : defaultLanguage;
}

/**
 * Load the language file
 * @param {string} lang - The language to load
 * @returns {Promise<object>} A promise that resolves with the language data
 * @example
 * const langData = await loadLanguage("en");
 */
async function loadLanguage(lang) {
	try {
		const response = await fetch(`locales/${lang}.json`);
		if (!response.ok) {
			throw new Error(`Failed to load ${lang}.json`);
		}
		return await response.json();
	} catch (error) {
		console.error(error);
		// Fallback to default language if the requested language fails to load
		if (lang !== defaultLanguage) {
			return loadLanguage(defaultLanguage);
		}
	}
}

/**
 * Translate the page
 * @param {object} langData - The language data
 * @example
 * const langData = await loadLanguage("en");
 * translatePage(langData);
 */
function translatePage(langData) {
	document.querySelectorAll("[data-i18n]").forEach((element) => {
		const key = element.getAttribute("data-i18n");
		const translation = getTranslation(langData, key);
		if (translation) {
			element.innerHTML = translation;
		}
	});
}

/**
 * Get the translation for a given key
 * @param {object} langData - The language data
 * @param {string} key - The key to translate
 * @returns {string|null} The translation or null if not found
 * @example
 * const translation = getTranslation(langData, "website.title");
 */
function getTranslation(langData, key) {
	return key.split(".").reduce((obj, k) => (obj ? obj[k] : null), langData);
}

/**
 * Initialize the localization
 * @example
 * initLocalization();
 */
async function initLocalization() {
	const userLanguage = getUserLanguage();
	const langData = await loadLanguage(userLanguage);
	if (langData) {
		translatePage(langData);
	}
}

// Initialize the localization when the DOM is ready
document.addEventListener("DOMContentLoaded", initLocalization);
