// Imports
import "https://cdn.jsdelivr.net/npm/axios/dist/axios.min.js";
import axiosRetry from "https://cdn.jsdelivr.net/npm/axios-retry/+esm";

// Initialization
const cloudFunctionURL = "https://us-central1-guiruggiero.cloudfunctions.net/guipt";

// Retry configuration
axiosRetry(axios, {
    retries: 2, // Retry attempts
    retryDelay: axiosRetry.exponentialDelay, // 1s then 2s between retries
    retryCondition: (error) => { // Only retry on network or 5xx errors
        return axiosRetry.isNetworkOrIdempotentRequestError(error) ||
               (error.response?.status >= 500);
    },
});

// Call GuiPT
export default async function callGuiPT(chatHistory, userMessage) {
    return await axios.post(cloudFunctionURL, {
        history: chatHistory,
        message: userMessage,
    }, {
        timeout: 4000, // 4s
    }).catch(error => {
        // Add context but don't report it here
        error.source = "guipt.js";

        // Rethrow to handle in main
        throw error;
    });
}
