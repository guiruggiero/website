// Imports
// import {firebaseApp} from "./firebase.js"; // App Check
// import {initializeAppCheck, ReCaptchaV3Provider, getToken} from "https://www.gstatic.com/firebasejs/12.3.0/firebase-app-check.js"; // App Check
import "https://cdn.jsdelivr.net/npm/axios/dist/axios.min.js";
// import "https://cdn.jsdelivr.net/npm/axios-retry/+esm"; // TODO: https://cdn.jsdelivr.net/npm/axios-retry/dist/cjs/index.min.js

// Initializations
// const appCheck = initializeAppCheck(firebaseApp, {provider: new ReCaptchaV3Provider("6LcYhLErAAAAAOs-5YIyE2MQQQ5nlajPsGAW6ny_")}); // App Check
const cloudFunctionURL = "https://us-central1-guiruggiero.cloudfunctions.net/guipt";

// Axios instance
const axiosInstance = axios.create({
    baseURL: cloudFunctionURL,
    timeout: 5000, // 5s
});

// Add App Check token to every request - App Check
// axiosInstance.interceptors.request.use(async (config) => {
//     const {token} = await getToken(appCheck, false);
//     config.headers["X-Firebase-AppCheck"] = token;
//     return config;
// });

// Retry configuration - TODO
// axiosRetry(axiosInstance, {
//     retries: 2, // Retry attempts
//     retryDelay: axiosRetry.exponentialDelay, // 1s then 2s between retries
//     // Only retry on network or 5xx errors
//     retryCondition: (error) => {
//         return axiosRetry.isNetworkOrIdempotentRequestError(error) ||
//                (error.response && error.response.status >= 500);
//     },
// });

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
            // retryCount: error.config?.retryCount || 0,
        };

        // Rethrow error
        throw error;
    });
}
