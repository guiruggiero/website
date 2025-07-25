// Import
import "https://cdn.jsdelivr.net/npm/axios/dist/axios.min.js";

// Initialization
const cloudFunctionURL = "https://guipt.guiruggiero.com/";

// Axios instance with retry configuration
const axiosInstance = axios.create({
    baseURL: cloudFunctionURL,
    timeout: 4000, // 4s
    retry: 2, // Number of retry attempts
    retryDelay: (retryCount) => {
        return retryCount * 1000; // 1s, then 2s between retries
    },
});

// Interceptor to handle retries
axiosInstance.interceptors.response.use(null, async(error) => {
    const config = error.config;
    
    // Only retry on network errors or 5xx responses
    if (!config || !config.retry || (error.response && error.response.status < 500 && error.response.status >= 0)) {
        return Promise.reject(error);
    }
    
    config.retryCount = config.retryCount || 0;
    
    if (config.retryCount >= config.retry) {
        return Promise.reject(error);
    }
    
    config.retryCount++;
    const delay = config.retryDelay(config.retryCount);
    
    await new Promise(resolve => setTimeout(resolve, delay));
    return axiosInstance(config);
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