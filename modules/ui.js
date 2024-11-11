import "https://unpkg.com/typed.js/dist/typed.umd.js";

// Initialization
let chatWindowExpanded = false;

// DOM elements
export const elements = {
    logo: document.querySelector("#logo"),
    chatContainer: document.querySelector("#chat-container"),
    chatWindow: document.querySelector("#chat-window"),
    // loader: document.querySelector("#loader"), // TODO
    // error: document.querySelector("#error"), // TODO
    inputContainer: document.querySelector("#input-container"),
    input: document.querySelector("input"),
    submit: document.querySelector("#submit"),
    suggestions: document.querySelector("#suggestions")
};

// Focus on input without opening virtual keyboard
export function inputFocus() {
    elements.input.setAttribute("readonly", "readonly");
    elements.input.focus();
    elements.input.removeAttribute("readonly");
}

// Type input placeholder and then focus
export function inputPlaceholderAndFocus() {
    new Typed(elements.input, {
        strings: ["^500 Ask me anything about Gui..."], // Waits 500ms before typing
        contentType: "null",
        attr: "placeholder",
        typeSpeed: 10,
        showCursor: false,
        onComplete: inputFocus
    });
}

// Allow/forbid submit button
export function toggleSubmitButton() {
    const hasContent = elements.input.value.trim().length > 0;
    elements.submit.classList.toggle("active", hasContent);
}

// Clear input box
export function clearInput() {
    elements.input.value = "";
}

// Close virtual keyboard
export function closeKeyboard() {
    elements.input.blur();
}

// Change input placeholder
export function changePlaceholder(text) {
    elements.input.placeholder = text;
}

// Allow/forbid input
export function toggleInput() {
    const currentState = elements.input.disabled;
    elements.input.disabled = !currentState;
}

// Display loader
// export function displayLoader() {
//     elements.error.style.display = "none";
//     elements.loader.style.display = "block";
// }

// Expand chat window
export function expandChatWindow() {
    if (!chatWindowExpanded) { // TODO: play with order and delay
        // Set initial size to match input container
        elements.chatContainer.style.width = `${elements.inputContainer.offsetWidth}px`;
        elements.chatContainer.style.height = `${elements.inputContainer.offsetHeight}px`;
        
        // Force a reflow
        elements.chatContainer.offsetHeight;
        
        // Expand to full size
        elements.chatContainer.style.maxWidth = "800px";
        elements.chatContainer.style.width = "min(90vw, 900px)"; // TODO: calc(100% - 70px) for responsive layout?
        elements.chatContainer.style.maxHeight = "600px";
        elements.chatContainer.style.height = "min(80vh, 800px)";
        
        // Bring back input container to view
        elements.inputContainer.style.padding = "10px";
        elements.inputContainer.style.backgroundColor = "#262626";

        // Fade in inner content and hide logo/suggestions
        setTimeout(() => {
            elements.chatWindow.style.height = "calc(100% - 70px)";
            elements.chatWindow.style.opacity = "1";
            elements.chatWindow.style.padding = "15px 9px 15px 15px";
            elements.chatWindow.style.marginTop = "10px";
            elements.logo.style.opacity = "0";
            elements.suggestions.style.opacity = "0";
        }, 0);

        chatWindowExpanded = true;
    }
}

// Add message to chat window
export function addMessage(message, isUser) {
    // Create messages container if it doesn't exist (for right scrolling)
    let messagesContainer = elements.chatWindow.querySelector(".messages-container");
    if (!messagesContainer) {
        messagesContainer = document.createElement("div");
        messagesContainer.className = "messages-container";
        elements.chatWindow.appendChild(messagesContainer);
    }

    // Animate the message in, regardless of content
    function animateMessage() {
        messagesContainer.appendChild(messageElement);

        // Animate the message in
        messageElement.style.opacity = "0";
        messageElement.style.transform = "translateY(10px)"; // 20px
        messageElement.offsetHeight;
        messageElement.style.transition = "all 0.5s ease";
        messageElement.style.opacity = "1";
        messageElement.style.transform = "translateY(0)";
        
        // Scroll to bottom
        elements.chatWindow.scrollTop = elements.chatWindow.scrollHeight;
    }

    // Create new message
    const messageElement = document.createElement("div");
    messageElement.classList.add("message", isUser ? "user-message" : "bot-message");
    if (isUser) {
        messageElement.textContent = message;
        animateMessage();
    } else {
        animateMessage();
        
        // Replace the & character so Typed doesn't stop
        message = message.replace(/&/g, "&amp;");

        // Scroll to bottom if height changes
        const resizeObserver = new ResizeObserver(() => {
            elements.chatWindow.scrollTop = elements.chatWindow.scrollHeight;
        });

        // Type response
        new Typed(messageElement, {
            strings: [message],
            contentType: "html",
            typeSpeed: 10,
            showCursor: false,
            onBegin: () => {
                resizeObserver.observe(messageElement);
            },
            onComplete: () => {
                resizeObserver.disconnect();
            }
        });
    }
}