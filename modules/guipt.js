import "https://unpkg.com/axios/dist/axios.min.js";

// Initialization
const cloudFunctionURL = "https://us-central1-guiruggiero.cloudfunctions.net/guipt";

// Call GuiPT
export async function callGuiPT(chatHistory, sanitizedInput) {
    return await axios.post(cloudFunctionURL, null, {
        params: {
            history: chatHistory,
            prompt: sanitizedInput
        }
    });
}