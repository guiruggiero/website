import "https://cdnjs.cloudflare.com/ajax/libs/axios/1.7.2/axios.min.js";
import {getApp, getApps, initializeApp} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js";
import {getFirestore, addDoc, collection, doc, Timestamp, runTransaction} from
    "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore-lite.js"

// Firebase Firestore
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
const firestoreMode = "mvp"; // "dev", "mvp", "v1"

// Fetch elements
const inputElement = document.querySelector("input");
const submitButton = document.querySelector("#submit");
const responseElement = document.querySelector("#response");
const errorElement = document.querySelector("#error");
const loaderElement = document.querySelector("#loader");

// Display text
function displayText(type, text) {
    loaderElement.style.display = "none";

    // Response message
    if (type == "response") {
        errorElement.style.display = "none";
        errorElement.textContent = "";
        responseElement.textContent = "";
        responseElement.style.display = "block";;
        responseElement.style.setProperty("--response-length", text.length); // for typewriter steps
        responseElement.textContent = text;
    }

    // Error message
    else if (type == "error") {
        responseElement.style.display = "none";
        responseElement.textContent = "";
        errorElement.textContent = text;
        errorElement.style.display = "block";
    }

    toggleInput("enable");
    inputFocus();
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

// Close virtual keyboard
function closeKeyboard() {
    inputElement.blur();
};

// Focus on input box without opening virtual keyboard
function inputFocus() {
    inputElement.setAttribute('readonly', 'readonly');
    inputElement.focus();
    inputElement.removeAttribute('readonly');
}

// Toggle input box enable/disabled
function toggleInput(state) {
    if (state == "disable") inputElement.disabled = true;
    else if (state == "enable") inputElement.disabled = false;
}

// Sanitize potentially harmful characters
function sanitizeInput(input){
    input = input.replace(/<[^>]+>/g, ""); // Remove HTML tags
    input = input.replace(/[\s\t\r\n]+/g, " "); // Normalize whitespace

    return input;
};

// Assess guardrails
function validateInput(input) {
    // Empty input
    if (input.length == 0 || input == " ") {
        return {
            assessment: "Empty",
            message: ""
        };
    } 

    // Length limit
    if (input.length > 500) {
        return {
            assessment: "Too long",
            message: "⚠️ Oops! Your question is too long, please make it shorter."
        };
    }

    // Character set - allow only alphanumeric (including accented), spaces, and basic punctuation
    if (!/^[A-Za-zÀ-ÖØ-öø-ÿ0-9\s.,!?;:'"()-]+$/.test(input)) { // @$%&/+
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

// Create the chat log with the first turn
async function createLog(chatStart, turnData) {
    const chatRef = await addDoc(collection(db, firestoreMode), {
        start: chatStart,
        turnCount: 1,
        turns: {1: turnData}
    });

    return chatRef.id;
};

// Log subsequent turns
async function logTurn(chatID, turnCount, turnData, duration) {
    const chatRef = doc(db, firestoreMode, chatID);

    await runTransaction(db, async (transaction) => {
        // Get chat data
        const chatDoc = await transaction.get(chatRef);
        const turnHistory = chatDoc.data().turns;

        // Appends new turn
        const updatedTurnHistory = {...turnHistory, [turnCount]: turnData};

        // Updates chat document
        transaction.update(chatRef, {
            turnCount: turnCount,
            duration: duration,
            turns: updatedTurnHistory
        });
    });
};

// --

// Initializations
const cloudFunctionURL = "https://us-central1-guiruggiero.cloudfunctions.net/guipt";
let timeoutFunction;
let chatHistory = [];
let turnCount = 0;
let chatStart, chatID;

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
            if (validationResult.assessment == "Too long") clearInput(); // Likely copy/paste, erase input
            displayText("error", validationResult.message);
            return;
        }

        // Update UI to indicate loading
        closeKeyboard();
        clearInput();
        toggleInput("disable");
        displayLoader();

        // Handle timeout
        const timeout = 31000;
        timeoutFunction = setTimeout(() => {
            displayText("error", "⚠️ Oops! This is taking too long... Can you please try again?");
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

                // Save chat history
                chatHistory.push({role: "user", parts: [{text: sanitizedInput}]});
                chatHistory.push({role: "model", parts: [{text: guiptResponse}]});
                
                // Log chat/turn
                turnCount++;
                const turnData = {
                    user: sanitizedInput,
                    model: guiptResponse
                };
                if (turnCount == 1) {
                    chatID = await createLog(chatStart, turnData);
                } else {
                    let duration = (Timestamp.now().toDate() - chatStart)/(1000*60); // Minutes
                    duration = Number(duration.toFixed(2)); // 2 decimal places
                    await logTurn(chatID, turnCount, turnData, duration);
                };
            });
    }
    
    // Handle errors
    catch (error) {
        clearTimeout(timeoutFunction);
        console.error("Error: ", error);
        displayText("error", "⚠️ Oops! Something went wrong, can you please try again?");
    };
};

// --

// Create events
document.addEventListener("DOMContentLoaded", () => {
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