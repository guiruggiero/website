const {initializeApp} = require("firebase/app");
const {getFirestore, addDoc, collection, doc, updateDoc, Timestamp}
    = require("firebase/firestore/lite");

// Firebase Firestore
const firebaseConfig = {
    apiKey: "AIzaSyDOa3qhxiNI_asmIo1In1UF_qNjO1qllBE",
    authDomain: "guiruggiero.firebaseapp.com",
    projectId: "guiruggiero",
    storageBucket: "guiruggiero.appspot.com",
    messagingSenderId: "49247152565",
    appId: "1:49247152565:web:eb614bed7a4cf43ed611fc"
};
const firebaseApp = initializeApp(firebaseConfig);
const db = getFirestore(firebaseApp);
const firestoreMode = "dev"; // "dev", "mvp", "v1"

// Fetch elements
const inputElement = document.querySelector("input");
const submitButton = document.querySelector("#submit");
const outputElement = document.querySelector("#output");

// Display text
function displayText(text) {
    outputElement.textContent = text;
}

// Clear input box
function clearInput() {
    inputElement.value = "";
}

// Close virtual keyboard
function closeKeyboard() {
    inputElement.blur();
}

// Sanitize potentially harmful characters
function sanitizeInput(input){
    input = input.replace(/<[^>]+>/g, ""); // Remove HTML tags
    input = input.replace(/[\s\t\r\n]+/g, " "); // Normalize whitespace

    return input;
}

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
}

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
async function logTurn(chatID, turnCount, turnData, chatEnd) {
    const chatRef = doc(db, firestoreMode, chatID);

    await runTransaction(db, async (transaction) => {
        // Update documents on chat collection
        const chatDoc = transaction.get(chatRef);
        transaction.update(chatRef, {
            end: chatEnd,
            turnCount: turnCount,
        });

        // Add new turn document to the subcollection
        const turnRef = doc(chatRef, 'turns', turnCount.toString());
        transaction.set(turnRef, turnData);
    });
}