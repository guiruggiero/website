// Imports
import {getApps, initializeApp, getApp} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import {getAuth, signInWithPopup, GoogleAuthProvider, signOut, onAuthStateChanged} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";

// Same project as firebase.js, but its own API key
const firebaseConfig = {
    apiKey: "AIzaSyCrOg_PuJ2VHCj5h8HLbOjk06QQFYMEF3g",
    authDomain: "guiruggiero.firebaseapp.com",
    projectId: "guiruggiero",
    storageBucket: "guiruggiero.firebasestorage.app",
    messagingSenderId: "49247152565",
    appId: "1:49247152565:web:eb614bed7a4cf43ed611fc",
};

// Initializations - shared with admin-firestore.js
export const firebaseApp = !getApps().length ? initializeApp(firebaseConfig) : getApp();
export const auth = getAuth(firebaseApp);

// Show a message on the sign-in overlay
function showAuthError(message) {
    const authError = document.getElementById("auth-error");
    if (authError) authError.textContent = message;
}

// Gates the page behind Google sign-in; resolves once signed in
export function initAdminAuth() {
    return new Promise((resolve) => {
        // DOM elements
        const authOverlay = document.getElementById("auth-overlay");
        const adminContent = document.getElementById("admin-content");
        const signInButton = document.getElementById("sign-in");
        const signOutButton = document.getElementById("sign-out");

        // Sign in with a Google popup
        signInButton?.addEventListener("click", async () => {
            showAuthError("");

            try {
                await signInWithPopup(auth, new GoogleAuthProvider());

            } catch (error) {
                // Closing the popup or double-clicking the button isn't worth reporting
                if (error.code === "auth/popup-closed-by-user" ||
                    error.code === "auth/cancelled-popup-request") return;

                showAuthError("Sign-in failed, please try again");

                // Capture error with context
                Sentry.captureException(error, {contexts: {adminAuth: {
                    operation: "signIn",
                    code: error.code,
                }}});
            }
        });

        // Sign out and fall back to the overlay
        signOutButton?.addEventListener("click", async () => {
            try {
                await signOut(auth);
                globalThis.location.reload();

            } catch (error) {
                // Capture error with context
                Sentry.captureException(error, {contexts: {adminAuth: {
                    operation: "signOut",
                    code: error.code,
                }}});
            }
        });

        // Fires immediately with any restored session, then on every change
        onAuthStateChanged(auth, (user) => {
            if (user) {
                authOverlay?.setAttribute("hidden", "");
                adminContent?.removeAttribute("hidden");
                signOutButton?.removeAttribute("hidden");

                // No-op after the first sign-in
                resolve(user);

            } else {
                authOverlay?.removeAttribute("hidden");
                adminContent?.setAttribute("hidden", "");
                signOutButton?.setAttribute("hidden", "");
            }
        });
    });
}