import "https://unpkg.com/typed.js@2.1.0/dist/typed.umd.js"; // https://mattboldt.github.io/typed.js/docs/
// import {getApp, getApps, initializeApp} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-app.js"; // https://firebase.google.com/docs/web/learn-more#libraries-cdn
// import {getFirestore, addDoc, collection, doc, updateDoc, Timestamp} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore-lite.js"
// import "https://unpkg.com/axios/dist/axios.min.js";

// -- UI manipulation

// Fetch elements
const logoElement = document.querySelector("#logo");
const chatContainer = document.querySelector("#chat-container");
const chatWindow = document.querySelector("#chat-window");
// const loaderElement = document.querySelector("#loader");
// const errorElement = document.querySelector("#error");
const inputContainer = document.querySelector("#input-container");
const inputElement = document.querySelector("input");
const submitButton = document.querySelector("#submit");

let chatWindowExpanded = false; // TODO: move to initializations

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
        strings: ["^1000 Ask me anything about Gui..."], // Waits 1000ms before typing
        contentType: "null",
        attr: "placeholder",
        typeSpeed: 30,
        showCursor: false,

        // After typed everything
        onComplete: () => {
            inputFocus();
        }
    });
};







function expandChatWindow() {
    if (!chatWindowExpanded) {
        // Set initial size to match the search bar
        chatContainer.style.width = `${inputContainer.offsetWidth}px`;
        chatContainer.style.height = `${inputContainer.offsetHeight}px`;
        
        // Force a reflow
        chatContainer.offsetHeight;
        
        // Expand to full size
        chatContainer.style.width = "min(90vw, 900px)";
        chatContainer.style.height = "min(80vh, 800px)";
        chatContainer.style.maxHeight = "600px"; // calc(100% - 70px) for responsiveness?
        chatContainer.style.maxWidth = "800px";
        
        // Bring back input container to view
        inputContainer.style.padding = "10px";
        inputContainer.style.backgroundColor = "#262626";

        setTimeout(() => {
            chatWindow.style.height = "calc(100% - 70px)";
            chatWindow.style.opacity = "1";
            chatWindow.style.padding = "15px";
            chatWindow.style.marginTop = "10px";
            logoElement.style.opacity = "0";
        }, 50);

        chatWindowExpanded = true;
    }
}

function addMessage(message, isUser) {
    // Check if messages container exists, if not create it
    let messagesContainer = chatWindow.querySelector('.messages-container');
    if (!messagesContainer) {
        messagesContainer = document.createElement('div');
        messagesContainer.className = 'messages-container';
        chatWindow.appendChild(messagesContainer);
    }

    const messageElement = document.createElement("div");
    messageElement.classList.add("message");
    messageElement.classList.add(isUser ? "user-message" : "bot-message");
    messageElement.textContent = message;

    // Add animation class for smooth entry
    messageElement.style.opacity = "0";
    messageElement.style.transform = "translateY(20px)";
    
    // chatWindow.appendChild(messageElement);
    messagesContainer.appendChild(messageElement);
    
    // Force a reflow to ensure the animation plays
    messageElement.offsetHeight;
    
    // Animate the message in
    messageElement.style.transition = "all 0.5s ease";
    messageElement.style.opacity = "1";
    messageElement.style.transform = "translateY(0)";
    
    // Scroll to bottom smoothly
    chatWindow.scrollTop = chatWindow.scrollHeight;
}

function handleSubmit() {
    const message = inputElement.value;
    if (message.trim() === "") return;

    expandChatWindow();
    addMessage(message, true);

    // Simulate bot response
    setTimeout(() => {
        addMessage("This is a simulated response from the LLM chatbot.", false);
    }, 1000);

    inputElement.value = "";
}

submitButton.addEventListener("click", handleSubmit);

inputElement.addEventListener("keypress", (e) => {
    if (e.key === "Enter") handleSubmit();
});











// After all the page loading is complete
inputPlaceholderAndFocus();