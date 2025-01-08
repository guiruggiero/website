import * as UI from "./ui.js";
import * as Validation from "./validation.js";
import * as Firebase from "./firebase.js";
import { callGuiPT } from "./guipt.js";

// Initializations
let turnCount = 0;
let chatStart, chatID;
let timeoutFunction;
let chatHistory = [], turnHistory;
let isTimedOut = false;

// Rate limiting
const rateLimit = 5; // Max requests
const timeWindow = 60000; // 1 minute
let requestCount = 0;
let windowStart = Date.now();

// Orchestrate everything
async function handleGuiPT() {
    // Get start time for logs if it's the first turn
    if (turnCount == 0) chatStart = Firebase.Timestamp.now().toDate();

    // Get and validate input
    const input = UI.elements.input.value;
    const sanitizedInput = Validation.sanitizeInput(input);
    const validationResult = Validation.validateInput(sanitizedInput);

    // Don't act on input if input doesn't pass validation
    if (validationResult.assessment === "Empty") return;
    if (validationResult.assessment !== "OK") {
        if (validationResult.assessment === "Too long") UI.clearInput(); // Likely copy/paste
        if (!UI.chatWindowExpanded) UI.expandChatWindow(); // Expand only on first turn
        UI.addMessage("error", validationResult.errorMessage);
        return;
    }

    // Update UI to acknowledge input
    UI.closeKeyboard();
    UI.changePlaceholder(" Reply to GuiPT");
    UI.clearInput();
    UI.toggleInput();
    UI.toggleSubmitButton();
    if (!UI.chatWindowExpanded) UI.expandChatWindow(); // Expand only on first turn
    if (turnCount == 2) UI.elements.disclaimer.remove(); // Remove disclaimer on second successful message sent with chat window opened
    UI.addMessage("user", input);
    const loaderContainer = UI.showLoader();

    // Handle timeout
    timeoutFunction = setTimeout(() => {
        isTimedOut = true;
        loaderContainer.remove();
        UI.addMessage("error", "⚠️ ZzZzZ... This is taking too long, can you please try again?");
        UI.toggleInput();
        UI.inputFocus();
    }, 31000); // 31 seconds

    try {
        // Reset if time window has passed (for rate limiting)
        const now = Date.now();
        if (now - windowStart > timeWindow) {
            requestCount = 0;
            windowStart = now;
        }
        
        // Check if rate limit is exceeded
        if (requestCount >= rateLimit) {
            loaderContainer.remove();
            UI.addMessage("error", "⚠️ Whoa! Too many messages, too fast. Please wait a bit to try again.");
            clearTimeout(timeoutFunction);
            setTimeout(() => { // Penalty, sit and wait without input
                UI.toggleInput();
                UI.inputFocus();
            }, timeWindow - (now - windowStart));
            return;
        }
        requestCount++;
        
        // Call GuiPT
        const response = await callGuiPT(chatHistory, sanitizedInput);

        // Successful response
        clearTimeout(timeoutFunction);

        // Get and show response
        const guiptResponse = response.data;
        UI.addMessage("bot", guiptResponse, loaderContainer);
        turnCount++;

        // Save turn in chat history
        chatHistory.push(
            {role: "user", parts: [{text: sanitizedInput}]},
            {role: "model", parts: [{text: guiptResponse}]}
        );
        
        // Turn to be logged
        const turnData = {
            user: sanitizedInput,
            model: guiptResponse
        };

        // Create log if first turn, otherwise update log
        if (turnCount === 1) {
            turnHistory = {[turnCount]: turnData};
            chatID = await Firebase.createLog(chatStart, turnHistory);
        } else {
            turnHistory = {...turnHistory, [turnCount]: turnData}; // Append turn
            let duration = (Firebase.Timestamp.now().toDate() - chatStart)/(1000*60); // Minutes
            duration = Number(duration.toFixed(2)); // 2 decimal places
            await Firebase.logTurn(chatID, turnCount, duration, turnHistory);
        }

    } catch (error) {
        // Error after timeout
        if (isTimedOut) return;

        // Error before timeout
        clearTimeout(timeoutFunction);

        // Only show error message if it's not a Firebase error 
        if (!error.toString().includes("Firebase")) {
            loaderContainer.remove();
            UI.addMessage("error", "⚠️ Oops! Something went wrong, can you please try again?");
        }

        console.error(error);
    }
    
    // Alow input again
    UI.toggleInput();
    UI.inputFocus();
}

// Debounce function to limit input handling frequency
function debounce(func, wait) {
    let timeout;
    return function (...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), wait);
    };
}

// Event handlers when page is done loading
document.addEventListener("DOMContentLoaded", () => {
    // Initial UI setup
    UI.inputPlaceholderAndFocus();

    // setTimeout(() => { // Debug: expand chat and show loader without input
    //     UI.expandChatWindow();
    //     UI.showLoader();
    // }, 2000);
    
    // Real-time input handling
    UI.elements.input.addEventListener("input", debounce(UI.toggleSubmitButton, 150));

    // Input submission
    UI.elements.submit.addEventListener("click", () => {
        handleGuiPT();
        UI.inputFocus();
    });
    UI.elements.input.addEventListener("keyup", debounce((e) => {
        if (e.key === "Enter") handleGuiPT();
    }, 150));
});