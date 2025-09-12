// Import
import "https://cdn.jsdelivr.net/npm/axios/dist/axios.min.js";
import "https://cdn.jsdelivr.net/npm/axios-retry/dist/cjs/index.min.js";

// Initialization
const cloudFunctionURL = "https://us-central1-guiruggiero.cloudfunctions.net/guipt";

// Axios instance
const axiosInstance = axios.create({
    baseURL: cloudFunctionURL,
    timeout: 4000, // 4s
});

// Retry configuration
axiosRetry(axiosInstance, {
    retries: 2, // Retry attempts
    retryDelay: axiosRetry.exponentialDelay, // 1s then 2s between retries
    // Only retry on network or 5xx errors
    retryCondition: (error) => {
        return axiosRetry.isNetworkOrIdempotentRequestError(error) ||
               (error.response && error.response.status >= 500);
    },
});

// Call GuiPT
export default async function callGuiPT(chatHistory, userMessage) {
    return await axiosInstance.post("", null, {
        params: {
            history: chatHistory,
            prompt: userMessage,
        },

    }).catch(error => {
        // Add context to the error but don't report it
        error.axiosContext = {
            status: error.response?.status,
            statusText: error.response?.statusText,
            retryCount: error.config?.retryCount || 0,
        };

        // Rethrow error
        throw error;
    });
}