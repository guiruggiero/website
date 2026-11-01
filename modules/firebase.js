// Imports
import {getApps, initializeApp, getApp} from "https://www.gstatic.com/firebasejs/13.1.0/firebase-app.js";
import {getFirestore, addDoc, collection, doc, updateDoc, Timestamp} from "https://www.gstatic.com/firebasejs/13.1.0/firebase-firestore-lite.js";

// Initializations
const firebaseConfig = {
    apiKey: "AIzaSyDOa3qhxiNI_asmIo1In1UF_qNjO1qllBE",
    authDomain: "guiruggiero.firebaseapp.com",
    projectId: "guiruggiero",
    storageBucket: "guiruggiero.firebasestorage.app",
    messagingSenderId: "49247152565",
    appId: "1:49247152565:web:eb614bed7a4cf43ed611fc",
};
const firebaseApp = !getApps().length ? initializeApp(firebaseConfig) : getApp();
const db = getFirestore(firebaseApp);

// Separate dev and prod in different collections
const isDev = globalThis.location?.href.includes("ngrok");
const env = isDev ? "dev" : "v1";
export const voiceCollection = isDev ? "voice-dev" : "voice"; // Sonic voice chats

// Create the chat log with the first turn(s); options default to text chat
export async function createLog(chatStart, turnHistory, {collectionName = env, turnCount = 1, extraFields = {}} = {}) {
    try {
        const chatRef = await addDoc(collection(db, collectionName), {
            origin: "guiruggiero.com",
            start: Timestamp.fromMillis(chatStart),
            turnCount,
            turns: turnHistory,
            ...extraFields,
        });
        return chatRef.id;

    } catch (error) {
        // Capture error with context
        Sentry.captureException(error, {contexts: {
            logDetails: {
                operation: "create",
                collectionName,
                turnCount,
                extraFields,
            },
            turnHistory,
        }});
        
        // Needs to return something to continue execution
        return null;
    }
}

// Log subsequent turns; duration is skipped when undefined, since Firestore rejects undefined values
export async function logTurn(chatID, turnCount, duration, turnHistory, {collectionName = env, extraFields = {}} = {}) {
    try {
        const chatRef = doc(db, collectionName, chatID);
        const update = {
            turnCount: turnCount,
            turns: turnHistory,
            ...extraFields,
        };
        if (duration !== undefined) update.duration = duration;
        await updateDoc(chatRef, update);

    } catch (error) {
        // Capture error with context
        Sentry.captureException(error, {contexts: {
            logDetails: {
                operation: "update",
                collectionName,
                chatID,
                turnNumber: turnCount,
            },
            turnHistory,
        }});
    }
}
