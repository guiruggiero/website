// Import module dynamically
async function importModule(path) {
    if (globalThis.location?.href.includes("ngrok")) return await import(path.replace(".min.js", ".js"));
    else return await import(path);
}

// Imports
const UI = await importModule("./ui.min.js");
const Validation = await importModule("./validation.min.js");
const Firebase = await importModule("./firebase.min.js");
const callGuiPT = (await importModule("./guipt.min.js")).default;
const langData = (await importModule("./localization.min.js")).default;

// Initializations
let turnCount = 0;
let messageCount = 0;
let chatStart = null;
let chatID = "";
let chatHistory = [];
let turnHistory = {};

// Timeout error class
class TimeoutError extends Error {
    constructor(message) {
        super(message);
        this.name = "TimeoutError";
    }
}

// Rate limiting
const timeWindow = 60000; // 1m
let requestCount = 0;
let windowStart = Date.now();

// Orchestrate everything
async function handleGuiPT() {
    // Get start time for logs if it's the first turn
    if (turnCount == 0) chatStart = new Date(Date.now());

    // Prevent and get input
    UI.toggleSubmitButton(false);
    UI.closeKeyboard();
    UI.toggleInput();
    const input = UI.elements.input?.value;

    // Remove disclaimer on second message sent with chat window opened
    if (messageCount == 2) UI.elements.disclaimer?.remove();
    messageCount++;
    
    // Validate input
    const sanitizedInput = Validation.sanitizeInput(input);
    const validationResult = Validation.validateInput(sanitizedInput);

    // Don't act on input if input doesn't pass validation
    if (validationResult.assessment !== "OK") {
        // Likely copy/paste
        if (validationResult.assessment == "Too long") UI.clearInput();

        if (validationResult.assessment !== "Empty") {
            if (!UI.chatWindowExpanded) UI.expandChatWindow(); // Expand only on first turn
            UI.addMessage("error", validationResult.errorMessage);
        }

        const hasContent = UI.elements.input?.value.trim().length > 0;
        UI.toggleSubmitButton(hasContent);
        UI.toggleInput();
        UI.inputFocus();

        // Capture error with context
        Sentry.captureException(new Error("Failed validation"), {contexts: {
            turnDetails: {
                turnNumber: turnCount + 1,
                userInput: input,
                userInputLength: input.length,
                sanitizedInput,
                sanitizedInputLength: sanitizedInput.length,
                validationResult,
            },
        }});

        return;
    }

    // Rate limit time window
    const now = Date.now();
    if (now - windowStart > timeWindow) {
        requestCount = 0;
        windowStart = now;
    }
    
    // Check if rate limit is exceeded
    if (requestCount >= 5) { // Max requests per minute
        const waitTime = timeWindow - (now - windowStart);
        UI.addMessage("error", langData.errorRequestLimit);

        // Penalty, sit and wait without input
        setTimeout(() => {
            UI.toggleSubmitButton(true);
            UI.toggleInput();
            UI.inputFocus();
        }, waitTime);

        // Capture error with context
        Sentry.captureException(new Error("Exceeded rate limit"), {contexts: {
            sessionDetails: {
                requestCount,
                turnCount: turnCount + 1,
                lastUserInput: input,
                lastSanitizedInput: sanitizedInput,
            },
        }});

        return;
    }
    requestCount++;
    
    // Acknowledge input
    if (!UI.chatWindowExpanded) UI.expandChatWindow(); // Expand only on first turn
    UI.clearInput();
    UI.addMessage("user", sanitizedInput);
    const loaderContainer = UI.showLoader();
    
    // Call GuiPT
    let guiptResponse = {};
    try {
        // Client timeout
        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new TimeoutError("Client timeout")), 16000); // 16s to account for axios retries (4+1+4+2+4=15s)
        });
        
        // Call GuiPT while racing against the timeout
        guiptResponse = await Promise.race([
            callGuiPT(chatHistory, sanitizedInput),
            timeoutPromise,
        ]);

    } catch(error) {
        loaderContainer.remove();

        // Errors with different display messages
        if (error instanceof TimeoutError || error.message?.includes("timeout")) UI.addMessage("error", langData.errorTimeout);
        else if (error.response?.data == "errorTooLong") UI.addMessage("error", langData.errorTooLong);
        else if (error.response?.data == "errorForbiddenChars") UI.addMessage("error", langData.errorForbiddenChars);
        else UI.addMessage("error", langData.errorGeneric); // Fallback for other errors
        
        // Bring back user input
        UI.populateInput(input);
        UI.toggleSubmitButton(true);
        UI.toggleInput();
        UI.inputFocus();

        // Capture error with context
        Sentry.captureException(error, {contexts: {
            source: error.source || "main.js",
            axiosRetryCount: error.config?.["axios-retry"]?.retryCount ?? "N/A",
            turnDetails: {
                turnNumber: turnCount + 1,
                userInput: input,
                sanitizedInput,
                chatID,
            },
            turnHistory,
        }});

        return;
    }

    // Show response
    UI.addMessage("bot", guiptResponse.data, loaderContainer);
    turnCount++;

    // Save turn in chat history
    chatHistory.push(
        {role: "user", parts: [{text: sanitizedInput}]},
        {role: "model", parts: [{text: guiptResponse.data}]},
    );
    
    // Turn to be logged
    const turnData = {
        user: sanitizedInput,
        model: guiptResponse.data,
    };

    // Create log if first turn, otherwise update log
    if (turnCount == 1) {
        turnHistory = {[turnCount]: turnData};
        chatID = await Firebase.createLog(chatStart, turnHistory);
    } else {
        turnHistory = {...turnHistory, [turnCount]: turnData}; // Append turn
        const duration = Number(((new Date() - chatStart) / 60000).toFixed(2)); // Minutes
        await Firebase.logTurn(chatID, turnCount, duration, turnHistory);
    }
    
    // Alow input again
    UI.changePlaceholder(langData.replyPlaceholder);
    UI.toggleInput();
    UI.inputFocus();
}

// Debounce function to limit input handling frequency
function debounce(func, wait) {
    let timeout = null;
    return function(...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), wait);
    };
}

// Run when page is done loading
function start() {
    // Initial UI setup
    setTimeout(() => UI.inputPlaceholderAndFocus(), 500);

    // Debug: expand chat and show loader without input
    // setTimeout(() => {
    //     UI.expandChatWindow();
    //     UI.showLoader();
    // }, 2000);

    // Real-time input handling
    UI.elements.input?.addEventListener("input", debounce(() => {
        const hasContent = UI.elements.input?.value.trim().length > 0;
        UI.toggleSubmitButton(hasContent);
        UI.togglePromptPills(!hasContent);
    }, 150));

    // Input submission
    UI.elements.submit?.addEventListener("pointerup", handleGuiPT);
    UI.elements.input?.addEventListener("keyup", debounce((event) => {
        if (event.key === "Enter") handleGuiPT();
    }, 150));

    setTimeout(() => UI.displayPromptPills(), 1000);
}

// Check if page is already loaded
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); // Page is still loading
else start(); // DOMContentLoaded already fired