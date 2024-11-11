import "https://unpkg.com/typed.js/dist/typed.umd.js";
// import "https://unpkg.com/sanitize-html/index.js"; //TODO
import {getApp, getApps, initializeApp} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-app.js"; // https://firebase.google.com/docs/web/learn-more#libraries-cdn
import {getFirestore, addDoc, collection, doc, updateDoc, Timestamp} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore-lite.js"
import "https://unpkg.com/axios/dist/axios.min.js";

/* UI manipulation functions */

// Fetch elements
const logoElement = document.querySelector("#logo");
const chatContainer = document.querySelector("#chat-container");
const chatWindow = document.querySelector("#chat-window");
// const loaderElement = document.querySelector("#loader"); // TODO
// const errorElement = document.querySelector("#error"); // TODO
const inputContainer = document.querySelector("#input-container");
const inputElement = document.querySelector("input");
const submitButton = document.querySelector("#submit");
const suggestionsElement = document.querySelector("#suggestions");

// Focus on input box without opening virtual keyboard
function inputFocus() {
    inputElement.setAttribute("readonly", "readonly");
    inputElement.focus();
    inputElement.removeAttribute("readonly");
}

// Type input placeholder and then focus
function inputPlaceholderAndFocus() {
    // eslint-disable-next-line no-undef
    new Typed(inputElement, {
        strings: ["^500 Ask me anything about Gui..."], // Waits 500ms before typing
        contentType: "null",
        attr: "placeholder",
        typeSpeed: 10,
        showCursor: false,

        // After typed everything
        onComplete: () => {
            inputFocus();
        }
    });
}

// Clear input box
function clearInput() {
    inputElement.value = "";
}

// Close virtual keyboard
function closeKeyboard() {
    inputElement.blur();
}

// Allow/forbid input box edit
function toggleInput(state) {
    if (state == "forbid") inputElement.disabled = true;
    else if (state == "allow") inputElement.disabled = false;
}

// Change input box placeholder
function changePlaceholder(text) {
    inputElement.placeholder = text;
}

// Display loader
// function displayLoader() {
//     responseElement.style.display = "none";
//     errorElement.style.display = "none";
//     loaderElement.style.display = "block";
// }

// Expand chat window
function expandChatWindow() {
    if (!chatWindowExpanded) { // TODO: play with order and delay
        // Set initial size to match input container
        chatContainer.style.width = `${inputContainer.offsetWidth}px`;
        chatContainer.style.height = `${inputContainer.offsetHeight}px`;
        
        // Force a reflow
        chatContainer.offsetHeight;
        
        // Expand container to full size
        chatContainer.style.maxWidth = "800px";
        chatContainer.style.width = "min(90vw, 900px)";
        // TODO: calc(100% - 70px) for responsive layout?
        chatContainer.style.maxHeight = "600px";
        chatContainer.style.height = "min(80vh, 800px)";
        
        // Bring back input container to view
        inputContainer.style.padding = "10px";
        inputContainer.style.backgroundColor = "#262626";

        // Fade in inner content and hide logo/suggestions
        setTimeout(() => {
            chatWindow.style.height = "calc(100% - 70px)";
            chatWindow.style.opacity = "1";
            chatWindow.style.padding = "15px 9px 15px 15px";
            chatWindow.style.marginTop = "10px";
            logoElement.style.opacity = "0";
            suggestionsElement.style.opacity = "0";
        }, 0);

        chatWindowExpanded = true;
    }
}

// Add message to chat window
function addMessage(message, isUser) {
    // Create messages container if it doesn't exist (for right scrolling)
    let messagesContainer = chatWindow.querySelector(".messages-container");
    if (!messagesContainer) {
        messagesContainer = document.createElement("div");
        messagesContainer.className = "messages-container";
        chatWindow.appendChild(messagesContainer);
    }

    // Create new message element
    const messageElement = document.createElement("div");
    messageElement.classList.add("message");
    messageElement.classList.add(isUser ? "user-message" : "bot-message");
    messageElement.textContent = message;
    messagesContainer.appendChild(messageElement);

    // Add animation class for smooth entry
    messageElement.style.opacity = "0";
    messageElement.style.transform = "translateY(20px)";
    
    // Force a reflow to ensure the animation plays
    messageElement.offsetHeight;
    
    // Animate the message in
    messageElement.style.transition = "all 0.5s ease"; // TODO: play with delay
    messageElement.style.opacity = "1";
    messageElement.style.transform = "translateY(0)";
    
    // Scroll to bottom smoothly
    chatWindow.scrollTop = chatWindow.scrollHeight;
}

/* Data handling functions - input manipulation and Firebase */

// Sanitize potentially harmful characters
function sanitizeInput(input) {
    input = input.replace(/[\s\t\r\n]+/g, " "); // Normalize whitespace
    input = input.trim(); // Remove whitespace from both ends
    input = input.replace(/<[^>]+>/g, ""); // Remove HTML tags

    return input;
}

// Assess guardrails
function validateInput(input) {
    let response;
    
    // Empty input
    if (!input || input == " ") {
        response = {assessment: "Empty",
            message: ""}
    }

    // Length limit
    else if (input.length > 200) {
        response = {assessment: "Too long",
            message: "⚠️ Oops! Your message is too long, please make it shorter."}
    }

    // Character set
    else if (!/^[A-Za-zÀ-ÖØ-öø-ÿ0-9\s.,!?;:'’"()-]+$/.test(input)) { // Excludes @$%&/+
        response = {assessment: "Forbidden characters",
            message: "⚠️ Oops! Please use only letters, numbers, and common punctuation."}
    }

    else response = {assessment: "OK",
        message: ""};

    return response;
}

// Firebase initializations
const firebaseConfig = {
    apiKey: "AIzaSyDOa3qhxiNI_asmIo1In1UF_qNjO1qllBE",
    authDomain: "guiruggiero.firebaseapp.com",
    projectId: "guiruggiero",
    storageBucket: "guiruggiero.appspot.com",
    messagingSenderId: "49247152565",
    appId: "1:49247152565:web:eb614bed7a4cf43ed611fc"
}
const firebaseApp = !getApps().length ? initializeApp(firebaseConfig) : getApp();
const db = getFirestore(firebaseApp);
const env = "v1";

// Create the chat log with the first turn
// eslint-disable-next-line no-unused-vars 
async function createLog(chatStart, turnHistory) {
    const chatRef = await addDoc(collection(db, env), {
        origin: "guiruggiero.com",
        start: chatStart,
        turnCount: 1,
        turns: turnHistory
    });

    return chatRef.id;
}

// Log subsequent turns
// eslint-disable-next-line no-unused-vars
async function logTurn(chatID, turnCount, turnHistory, duration) {
    const chatRef = doc(db, env, chatID);
    await updateDoc(chatRef, {
        turnCount: turnCount,
        duration: duration,
        turns: turnHistory
    });
}

/* Main function - orchestration and GuiPT call */

// Initializations
let chatWindowExpanded = false;
let turnCount = 0;
// eslint-disable-next-line no-unused-vars
let chatStart, chatID;
let timeoutFunction;
const cloudFunctionURL = "https://us-central1-guiruggiero.cloudfunctions.net/guipt";
let chatHistory = [], turnHistory;

// Orchestration and GuiPT call
async function GuiPT() {
    // Get start time for logs if it's the first turn
    if (turnCount == 0) chatStart = Timestamp.now().toDate();

    // Get and validate input
    const input = inputElement.value;
    const sanitizedInput = sanitizeInput(input);
    const validationResult = validateInput(sanitizedInput);

    // If no input, do nothing
    if (validationResult.assessment == "Empty") return;

    // Other guardrails
    if (validationResult.assessment != "OK") {
        if (validationResult.assessment == "Too long") clearInput(); // Likely copy/paste
        // displayText("error", validationResult.message); // TODO
        return;
    }

    // Update UI while waiting for response
    closeKeyboard();
    changePlaceholder(" Reply to GuiPT");
    clearInput();
    toggleInput("forbid");
    // displayLoader(); // TODO
    expandChatWindow();
    addMessage(input, true);

    // Handle timeout
    const timeout = 31000; // 31 seconds
    timeoutFunction = setTimeout(() => {
        // displayText("error", "⚠️ ZzZzZ... This is taking too long, can you please try again?"); // TODO
    }, timeout);

    try {
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
                addMessage(guiptResponse, false); // TODO: Typed
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
                    // chatID = await createLog(chatStart, turnHistory); // Local testing
                }
                
                // Update log
                else {
                    turnHistory = {...turnHistory, [turnCount]: turnData}; // Append turn
                    let duration = (Timestamp.now().toDate() - chatStart)/(1000*60); // Minutes
                    // eslint-disable-next-line no-unused-vars 
                    duration = Number(duration.toFixed(2)); // 2 decimal places
                    // await logTurn(chatID, turnCount, turnHistory, duration); // Local testing
                }
            });
    }
    
    // Handle errors
    catch (error) {
        clearTimeout(timeoutFunction);
        console.error(error);
        // displayText("error", "⚠️ Oops! Something went wrong, can you please try again?"); // TODO
    }
    
    // Alow input again
    toggleInput("allow");
    inputFocus();
}

/* Event handlers when page is done loading */

document.addEventListener("DOMContentLoaded", () => {
    // Click to submit button
    submitButton.addEventListener("click", () => {
        GuiPT();
        inputFocus();
    });

    // Enter key
    inputElement.addEventListener("keyup", (e) => {
        if (e.key === "Enter") GuiPT();
    });

    // Animate input placeholder
    inputPlaceholderAndFocus();
})