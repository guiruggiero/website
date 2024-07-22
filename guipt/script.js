import "https://cdnjs.cloudflare.com/ajax/libs/axios/1.7.2/axios.min.js";
import {getApp, getApps, initializeApp} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js";
import {getFirestore, addDoc, collection, doc, Timestamp, runTransaction} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore-lite.js"

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
const firestoreMode = "dev"; // "dev", "mvp", "v1"

// Fetch elements
const inputElement = document.querySelector("input");
const submitButton = document.querySelector("#submit");
const outputElement = document.querySelector("#output");

// Display text
function displayText(text) {
    outputElement.textContent = text;
};

// Clear input box
function clearInput() {
    inputElement.value = "";
};

// Close virtual keyboard
function closeKeyboard() {
    inputElement.blur();
};

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
            message: "Error: your question is too long, please keep it under 500 characters."
        };
    }

    // Character set - allow only alphanumeric (including accented), spaces, and basic punctuation
    if (!/^[A-Za-zÀ-ÖØ-öø-ÿ0-9\s.,!?;:'"()-]+$/.test(input)) { // @$%&/+
        return {
            assessment: "Forbidden characters",
            message: "Error: please use only letters, numbers, spaces, and common punctuation."
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

// Log subsequent turns - TODO: if considered 2 billed interactions, incorporate into code
async function logTurn(chatID, turnCount, turnData, chatEnd) {
    const chatRef = doc(db, firestoreMode, chatID);

    await runTransaction(db, async (transaction) => {
        // Get turns so far
        const chatDoc = await transaction.get(chatRef);
        const turnHistory = chatDoc.data().turns;

        // Appends new turn
        const updatedTurnHistory = {...turnHistory, [turnCount]: turnData};

        // Updates chat document
        transaction.update(chatRef, {
            turnCount: turnCount,
            end: chatEnd,
            turns: updatedTurnHistory
        });
    });
};

// --

// Initializations
const cloudFunctionURL = "https://us-central1-guiruggiero.cloudfunctions.net/guipt";
let chatHistory = [];
let turnCount = 0;
let chatStart, chatID;

async function GuiPT() {
    try {
        // Get start time for logs
        chatStart = Timestamp.now().toDate();

        // Get and validate input
        const input = inputElement.value;
        const sanitizedInput = sanitizeInput(input);
        const validationResult = validateInput(sanitizedInput);

        // Input validation
        // If previous message is not an error, stop but don't erase it
        if (validationResult.assessment == "Empty" && outputElement.textContent.substring(0, 5) != "Error") return;
        
        // Other guardrails
        if (validationResult.assessment != "OK") {
            if (validationResult.assessment == "Too long") clearInput(); // Likely copy/paste, erase input
            displayText(validationResult.message);
            return;
        }

        // Update UI to indicate loading
        closeKeyboard();
        clearInput();
        displayText("...");

        // Handle timeout
        const timeout = 61000;
        let timeoutFunction = setTimeout(() => {
            displayText("Error: request timed out, GuiPT might be AFK. Can you please try again?");
        }, timeout);

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
                displayText(guiptResponse);

                // Save chat history
                chatHistory.push({role: "user", parts: [{text: sanitizedInput}]});
                chatHistory.push({role: "model", parts: [{text: guiptResponse}]});
                
                // Log chat/turn
                turnCount++;
                let chatEnd = Timestamp.now().toDate();
                const turnData = {
                    user: sanitizedInput,
                    model: guiptResponse
                };
                if (turnCount == 1) {
                    chatID = await createLog(chatStart, turnData);
                } else {
                    await logTurn(chatID, turnCount, turnData, chatEnd);
                };
            });
    }
    
    // Handle errors
    catch (error) {
        clearTimeout(timeoutFunction);
        console.error("Error: ", error);
        displayText("Error: oops, something went wrong! Can you please try again?");
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