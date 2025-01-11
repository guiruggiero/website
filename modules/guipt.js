/* eslint-disable no-undef */
import "https://cdn.jsdelivr.net/npm/axios/dist/axios.min.js";

// Initialization
const cloudFunctionURL = "https://us-central1-guiruggiero.cloudfunctions.net/guipt";

// Axios instance with retry configuration
const axiosInstance = axios.create({
    baseURL: cloudFunctionURL,
    timeout: 8000, // 8s
    retry: 2, // Number of retry attempts
    retryDelay: (retryCount) => {
        return retryCount * 1000; // 1s, then 2s between retries
    }
});

// Interceptor to handle retries
axiosInstance.interceptors.response.use(null, async (error) => {
    const config = error.config;
    
    // Only retry on network errors or 5xx responses
    if (!config || !config.retry || (error.response && error.response.status < 500 && error.response.status >= 0)) {
        return Promise.reject(error);
    }
    
    config.retryCount = config.retryCount || 0;
    
    if (config.retryCount >= config.retry) {
        return Promise.reject(error);
    }
    
    config.retryCount += 1;
    const delay = config.retryDelay(config.retryCount);
    
    await new Promise(resolve => setTimeout(resolve, delay));
    return axiosInstance(config);
});

// Call GuiPT
export async function callGuiPT(chatHistory, userMessage) {
    try {
        const response = await axiosInstance.post("", null, {
            params: {
                history: chatHistory,
                prompt: userMessage
            }
        });
    
        return response.data;

    } catch (error) {
        console.error("GuiPT: ", error);
        throw error;
    }
}