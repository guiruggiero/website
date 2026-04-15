// Imports
import axios from "https://cdn.jsdelivr.net/npm/axios/+esm";
import axiosRetry from "https://cdn.jsdelivr.net/npm/axios-retry/+esm";

// Initialization
const cloudFunctionURL = "https://us-central1-guiruggiero.cloudfunctions.net/guipt";

// Retry configuration
axiosRetry(axios, {
    retries: 2, // Retry attempts
    retryDelay: axiosRetry.exponentialDelay, // 1s then 2s between retries
    retryCondition: (error) => { // Only retry on network, timeout, or 5xx errors
        return axiosRetry.isNetworkOrIdempotentRequestError(error) ||
               error.code === "ECONNABORTED" || // Explicit timeout retry (axios-retry v4+ excludes timeouts)
               (error.response?.status >= 500);
    },
});

// Call GuiPT
export default async function callGuiPT(chatHistory, userMessage) {
    return await axios.post(cloudFunctionURL, {
        history: chatHistory,
        message: userMessage,
    }, {
        timeout: 6000, // 6s
    }).catch(error => {
        // Add context but don't report it here
        error.source = "guipt.js";

        // Rethrow to handle in main
        throw error;
    });
}
