// Import
const langData = (await import(window.location.href.includes("ngrok") ? "./localization.js" : "./localization.min.js")).default;

// Sanitize potentially harmful characters
export function sanitizeInput(input) {
    return input
        .replace(/\s+/g, " ") // Normalize whitespace
        .trim() // Remove whitespace from both ends
        .replace(/<[^>]*?>/g, ""); // Remove HTML tags
}

// Assess guardrails
export function validateInput(input) {
    // Empty input
    if (!input || input == " ") {
        return {
            assessment: "Empty",
            errorMessage: "",
        };
    }

    // Length limit
    if (input.length > 200) {
        return {
            assessment: "Too long",
            errorMessage: langData.errorTooLong,
        };
    }

    // Character set
    if (!/^[A-Za-zÀ-ÖØ-öø-ÿ0-9\s.,!?;:'’"()-]+$/.test(input)) { // Excludes @$%&/+
        return {
            assessment: "Forbidden characters",
            errorMessage: langData.errorForbiddenChars,
        };
    }

    return {
        assessment: "OK",
        errorMessage: "",
    };
}