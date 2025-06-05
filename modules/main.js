// Global error handler
window.addEventListener("error", (event) => {
    Sentry.captureException(event.error, {contexts: {
        globalError: {
            file: event.filename,
            line: event.lineno,
            column: event.colno,
            errorMessage: event.error.message,
        },
    }});
});

// Unhandled promise rejection handler
window.addEventListener("unhandledrejection", (event) => {
    Sentry.captureException(event.reason, {contexts: {
        unhandledPromise: {
            status: "Unhandled promise rejection",
            name: event.reason.name || event.reason.constructor.name,
            reasonDetails: String(event.reason),
        },
    }});
});

// Import module dynamically
async function importModule(path) {
    if (!window.location.href.includes("ngrok")) return await import(path);
    else return await import(path.replace(".min.js", ".js"));
}

// Import Theme Toggle module first to apply theme immediately
let ThemeToggle;
try {
    ThemeToggle = await importModule("./theme-toggle.min.js");
    if (ThemeToggle && typeof ThemeToggle.initThemeToggle === 'function') {
        ThemeToggle.initThemeToggle();
    } else {
        console.error("ThemeToggle module loaded but initThemeToggle function not found.");
    }
} catch (error) {
    console.error("Error initializing ThemeToggle:", error);
    // Optionally, send to Sentry if configured here
    // Sentry.captureException(error, { level: "error", extra: { module: "ThemeToggle" } });
}

// Import modules
let UI = await importModule("./ui.min.js");
let Validation = await importModule("./validation.min.js");
let Firebase = await importModule("./firebase.min.js");
const GuiPTModule = await importModule("./guipt.min.js");
let callGuiPT = GuiPTModule.callGuiPT; // Extract specific function from GuiPT module

// Initializations
let turnCount = 0, messageCount = 0;
let chatStart, chatID;
let guiptResponse;
let chatHistory = [], turnHistory;

// Timeout error class
class TimeoutError extends Error {
    constructor(message) {
        super(message);
        this.name = "TimeoutError";
    }
}

// Rate limiting
const timeWindow = 60000; // 1 minute
let requestCount = 0;
let windowStart = Date.now();

// Orchestrate everything
async function handleGuiPT() {
    // Get start time for logs if it's the first turn
    if (turnCount == 0) chatStart = new Date(Date.now());

    // Prevent and get input
    UI.forbidSubmitButton();
    UI.closeKeyboard();
    UI.toggleInput();
    const input = UI.elements.input.value;

    // Remove disclaimer on second message sent with chat window opened
    if (messageCount == 2) UI.elements.disclaimer.remove();
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
        UI.toggleSubmitButton();
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
        UI.addMessage("error", "⚠️ Whoa! Too many messages, too fast. Wait a bit to try again.");

        // Penalty, sit and wait without input
        setTimeout(() => {
            UI.toggleSubmitButton();
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

    try {
        // Client timeout
        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new TimeoutError("Client timeout")), 17000); // 17s
        });
        
        // Call GuiPT while racing against the timeout
        guiptResponse = await Promise.race([
            callGuiPT(chatHistory, sanitizedInput),
            timeoutPromise,
        ]);

    } catch (error) {
        loaderContainer.remove();

        // Only error I want to display a different message for
        if (error.message == "Client timeout" || error instanceof TimeoutError) UI.addMessage("error", "⚠️ ZzZzZ... This is taking too long, can you please try again?");
        else UI.addMessage("error", "⚠️ Oops! Something went wrong, can you please try again?");
        
        // Bring back user input
        UI.populateInput(input);
        UI.toggleSubmitButton();
        UI.toggleInput();
        UI.inputFocus();

        // Capture error with context
        Sentry.captureException(error, {contexts: {
            turnDetails: {
                file: error.axiosContext ? "guipt.js" : "main.js",
                turnNumber: turnCount + 1,
                userInput: input,
                sanitizedInput,
                chatID,
                axiosContext: error.axiosContext || "No axiosContext present",
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
        let duration = (new Date(Date.now()) - chatStart)/(1000*60); // Minutes
        duration = Number(duration.toFixed(2)); // 2 decimal places
        await Firebase.logTurn(chatID, turnCount, duration, turnHistory);
    }
    
    // Alow input again
    UI.changePlaceholder(" Reply to GuiPT");
    UI.toggleInput();
    UI.inputFocus();
}

// Debounce function to limit input handling frequency
function debounce(func, wait) {
    let timeout;
    return function(...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), wait);
    };
}

// Run when page is done loading
function start() {
    // Initial UI setup
    UI.inputPlaceholderAndFocus();

    // Debug: expand chat and show loader without input
    // setTimeout(() => {
    //     UI.expandChatWindow();
    //     UI.showLoader();
    // }, 2000);

    // Real-time input handling
    UI.elements.input.addEventListener("input", debounce(UI.toggleSubmitButton, 150));

    // Input submission
    UI.elements.submit.addEventListener("pointerup", handleGuiPT);
    UI.elements.input.addEventListener("keyup", debounce((event) => {
        if (event.key === "Enter") handleGuiPT();
    }, 150));
}

// Check if page is already loaded
if (document.readyState === "loading") {
    // Page is still loading
    document.addEventListener("DOMContentLoaded", start);
} else {
    // DOMContentLoaded already fired, safe to start
    start();
}