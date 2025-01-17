import {getApp, getApps, initializeApp} from "https://www.gstatic.com/firebasejs/11.2.0/firebase-app.js";
import {getFirestore, addDoc, collection, doc, updateDoc} from "https://www.gstatic.com/firebasejs/11.2.0/firebase-firestore-lite.js"

// Initializations
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

// Separate dev and prod in different collections
let env = "v1";
if (window.location.href.includes("ngrok")) env = "dev";

// Create the chat log with the first turn
export async function createLog(chatStart, turnHistory) {
    try {
        const chatRef = await addDoc(collection(db, env), {
            origin: "guiruggiero.com",
            start: chatStart,
            turnCount: 1,
            turns: turnHistory
        });
        return chatRef.id;

    } catch (error) {
        console.error("Firebase - create:", error);
        return null;
    }
}

// Log subsequent turns
export async function logTurn(chatID, turnCount, duration, turnHistory) {
    try {
        const chatRef = doc(db, env, chatID);
        await updateDoc(chatRef, {
            turnCount: turnCount,
            duration: duration,
            turns: turnHistory
        });

    } catch (error) {
        console.error("Firebase - update:", error);
    }
}