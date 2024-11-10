import * as UI from "./ui.js";
import * as Validation from "./validation.js";
import * as Firebase from "./firebase.js";
import { callGuiPT } from "./guipt.js";

// Initializations
let turnCount = 0;
let chatStart, chatID;
let timeoutFunction;
let chatHistory = [], turnHistory;

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
        // displayText("error", validationResult.message); // TODO
        return;
    }

    // Update UI to acknowledge input
    UI.closeKeyboard();
    UI.changePlaceholder(" Reply to GuiPT");
    UI.clearInput();
    UI.toggleInput("forbid");
    // displayLoader(); // TODO
    UI.expandChatWindow();
    UI.addMessage(input, true);

    // Handle timeout
    const timeout = 31000; // 31 seconds
    timeoutFunction = setTimeout(() => {
        // displayText("error", "⚠️ ZzZzZ... This is taking too long, can you please try again?"); // TODO
    }, timeout);

    try {
        // Call GuiPT
        const response = await callGuiPT(chatHistory, sanitizedInput);

        // Successful response
        clearTimeout(timeoutFunction);

        // Get and show response
        const guiptResponse = response.data;
        UI.addMessage(guiptResponse, false); // TODO: Typed
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
            // chatID = await Firebase.createLog(chatStart, turnHistory); // Local testing
        } else {
            turnHistory = {...turnHistory, [turnCount]: turnData}; // Append turn
            const duration = Number(
                (Firebase.Timestamp.now().toDate() - chatStart)/(1000*60) // Minutes
            ).toFixed(2); // 2 decimal places
            // await Firebase.logTurn(chatID, turnCount, turnHistory, duration); // Local testing
        }

    } catch (error) {
        clearTimeout(timeoutFunction);
        console.error(error);
        // displayText("error", "⚠️ Oops! Something went wrong, can you please try again?"); // TODO
    }
    
    // Alow input again
    UI.toggleInput("allow");
    UI.inputFocus();
}


// Event handlers when page is done loading
document.addEventListener("DOMContentLoaded", () => {
    // Click to submit button
    UI.elements.submit.addEventListener("click", () => {
        handleGuiPT();
        UI.inputFocus();
    });

    // Enter key
    UI.elements.input.addEventListener("keyup", (e) => {
        if (e.key === "Enter") handleGuiPT();
    });

    // Animate input placeholder
    UI.inputPlaceholderAndFocus();
});