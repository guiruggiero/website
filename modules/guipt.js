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
               (error.response && error.response.status >= 500);
    },
});

// Call GuiPT
export default async function callGuiPT(chatHistory, userMessage) {
    return await axios.post(cloudFunctionURL, null, { // axiosInstance.post(""
        timeout: 5000, // 5s
        params: {
            history: chatHistory,
            prompt: userMessage,
        },

    }).catch(error => {
        // Add context to the error but don't report it
        error.axiosContext = {
            status: error.response?.status,
            statusText: error.response?.statusText,
            retryCount: error.config["axios-retry"]?.retryCount || 0,
        };

        // Rethrow error
        throw error;
    });
}