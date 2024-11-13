import "https://cdn.jsdelivr.net/npm/axios/dist/axios.min.js";

// Initialization
const cloudFunctionURL = "https://us-central1-guiruggiero.cloudfunctions.net/guipt";

// Call GuiPT
export async function callGuiPT(chatHistory, sanitizedInput) {
    // eslint-disable-next-line no-undef
    return await axios.post(cloudFunctionURL, null, {
        params: {
            history: chatHistory,
            prompt: sanitizedInput
        }
    });
}