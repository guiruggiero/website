// Display text
function displayText(messageType, text) {
    // First things, first - some text is coming
    loaderElement.style.display = "none";

    // Response message
    if (messageType == "response") {
        // Order matters for no flickering
        errorElement.style.display = "none";
        errorElement.textContent = "";
        responseElement.textContent = "";
        responseElement.style.display = "block";

        // Replacing the & character so Typed doesn't stop
        text = text.replace(/&/g, "&amp;");

        // Type response
        // eslint-disable-next-line no-undef
        new Typed(responseElement, {
            strings: [text],
            contentType: "html",
            typeSpeed: 10,
            showCursor: false,

            // After typed everything
            onComplete: () => {
                toggleInput("allow");
                inputFocus();
            }
        });
    }

    // Error message
    else if (messageType == "error") {
        // Order matters for no flickering
        responseElement.style.display = "none";
        responseElement.textContent = "";
        errorElement.textContent = text;
        errorElement.style.display = "block";

        // Allow and focus on input
        toggleInput("allow");
        inputFocus();
    }
};












// Display loader
function displayLoader() {
    responseElement.style.display = "none";
    errorElement.style.display = "none";
    loaderElement.style.display = "block";
};

// Clear input box
function clearInput() {
    inputElement.value = "";
};

// Change input box placeholder
function changePlaceholder(text) {
    inputElement.placeholder = text;
};

// Close virtual keyboard
function closeKeyboard() {
    inputElement.blur();
};

// Allow/forbid input box edit
function toggleInput(state) {
    if (state == "forbid") inputElement.disabled = true;
    else if (state == "allow") inputElement.disabled = false;
}











// -- Data manipulation

// Sanitize potentially harmful characters
function sanitizeInput(input){
    input = input.replace(/<[^>]+>/g, ""); // Remove HTML tags
    input = input.replace(/[\s\t\r\n]+/g, " "); // Normalize whitespace
    input = input.trim(); // Remove whitespace from both ends

    return input;
};

// Assess guardrails
function validateInput(input) {
    // Empty input
    if (!input || input == " ") {
        return {
            assessment: "Empty",
            message: ""
        };
    }

    // Length limit
    if (input.length > 200) {
        return {
            assessment: "Too long",
            message: "⚠️ Oops! Your message is too long, please make it shorter."
        };
    }

    // Character set - allow only alphanumeric (including accented), spaces, and basic punctuation
    if (!/^[A-Za-zÀ-ÖØ-öø-ÿ0-9\s.,!?;:'’"()-]+$/.test(input)) { // @$%&/+
        return {
            assessment: "Forbidden characters",
            message: "⚠️ Oops! Please use only letters, numbers, and common punctuation."
        };
    }

    return {
        assessment: "OK",
        message: ""
    };
};












// -- Firestore Firebase

// Initializations
const firebaseConfig = {
    apiKey: "AIzaSyDOa3qhxiNI_asmIo1In1UF_qNjO1qllBE",
    authDomain: "guiruggiero.firebaseapp.com",
    projectId: "guiruggiero",
    storageBucket: "guiruggiero.appspot.com",
    messagingSenderId: "49247152565",
    appId: "1:49247152565:web:eb614bed7a4cf43ed611fc"
};
// const firebaseApp = initializeApp(firebaseConfig);
const firebaseApp = !getApps().length ? initializeApp(firebaseConfig) : getApp();
const db = getFirestore(firebaseApp);
const firestoreMode = "mvp";

// Create the chat log with the first turn
async function createLog(chatStart, turnHistory) {
    const chatRef = await addDoc(collection(db, firestoreMode), {
        origin: "GuiPT",
        start: chatStart,
        turnCount: 1,
        turns: turnHistory
    });

    return chatRef.id;
};

// Log subsequent turns
async function logTurn(chatID, turnCount, turnHistory, duration) {
    const chatRef = doc(db, firestoreMode, chatID);
    await updateDoc(chatRef, {
        turnCount: turnCount,
        duration: duration,
        turns: turnHistory
    });
};















// -- Main function

// Initializations
const cloudFunctionURL = "https://us-central1-guiruggiero.cloudfunctions.net/guipt";
let timeoutFunction;
let chatHistory = [], turnHistory;
let turnCount = 0;
let chatStart, chatID;

// Main function
async function GuiPT() {
    try {
        // Get start time for logs if it's the potential first turn
        if (turnCount == 0) chatStart = Timestamp.now().toDate();

        // Get and validate input
        const input = inputElement.value;
        const sanitizedInput = sanitizeInput(input);
        const validationResult = validateInput(sanitizedInput);

        // Input validation
        // If previous message is not an error, stop but don't erase it
        if (validationResult.assessment == "Empty" && responseElement.style.display == "block") return;
        
        // Other guardrails
        if (validationResult.assessment != "OK") {
            if (validationResult.assessment == "Too long") clearInput(); // Likely copy/paste
            displayText("error", validationResult.message);
            return;
        }

        // Update UI to indicate loading
        closeKeyboard();
        changePlaceholder(" " + input);
        clearInput();
        toggleInput("forbid");
        displayLoader();

        // Handle timeout
        const timeout = 31000;
        timeoutFunction = setTimeout(() => {
            displayText("error", "⚠️ ZzZzZ... This is taking too long, can you please try again?");
        }, timeout);

        // eslint-disable-next-line no-undef
        await axios
            // Call GuiPT
            .post(cloudFunctionURL, null, {params: {
                history: chatHistory,
                prompt: sanitizedInput
            }})

            // Successful response
            .then(async (response) => {
                // Clear timeout
                clearTimeout(timeoutFunction);

                // Get and show GuiPT response
                const guiptResponse = response.data;
                displayText("response", guiptResponse);
                turnCount++;

                // Save chat history to pass to Gemini API
                chatHistory.push({role: "user", parts: [{text: sanitizedInput}]});
                chatHistory.push({role: "model", parts: [{text: guiptResponse}]});
                
                // Turn to be logged
                const turnData = {
                    user: sanitizedInput,
                    model: guiptResponse
                };

                // Create log
                if (turnCount == 1) {
                    turnHistory = {[turnCount]: turnData};
                    chatID = await createLog(chatStart, turnHistory);
                }
                
                // Update log
                else {
                    turnHistory = {...turnHistory, [turnCount]: turnData}; // Append turn
                    let duration = (Timestamp.now().toDate() - chatStart)/(1000*60); // Minutes
                    duration = Number(duration.toFixed(2)); // 2 decimal places
                    await logTurn(chatID, turnCount, turnHistory, duration);
                };
            });
    }
    
    // Handle errors
    catch (error) {
        clearTimeout(timeoutFunction);
        console.error(error);
        displayText("error", "⚠️ Oops! Something went wrong, can you please try again?");
    };
};

// -- Events

// Create events when page is done loading
document.addEventListener("DOMContentLoaded", () => {
    // Cookie consent banner
    // eslint-disable-next-line no-undef
    new CookieConsent();

    // Click to submit icon
    submitButton.addEventListener("click", () => {
        GuiPT();
    });

    // Enter key
    inputElement.addEventListener("keyup", (event) => {
        if (event.key === "Enter") {
            GuiPT();
        }
    });
});

