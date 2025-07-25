// Imports
import "https://cdn.jsdelivr.net/npm/typed.js/dist/typed.umd.min.js";
const langData = (await import(window.location.href.includes("ngrok") ? "./localization.js" : "./localization.min.js")).default;

// Initialization
export let chatWindowExpanded = false;

// DOM elements
export const elements = {
    header: document.querySelector("header"),
    logo: document.querySelector("#logo"),
    chatContainer: document.querySelector("#chat-container"),
    chatWindow: document.querySelector("#chat-window"),
    messagesContainer: null,
    inputContainer: document.querySelector("#input-container"),
    input: document.querySelector("input"),
    submit: document.querySelector("#submit"),
    promptPillsContainer: document.querySelector("#prompt-pills-container"),
};

// Focus on input without opening virtual keyboard
export function inputFocus() {
    elements.input.setAttribute("readonly", "readonly");
    elements.input.focus();
    elements.input.removeAttribute("readonly");
}

// Type input placeholder and focus
export function inputPlaceholderAndFocus() {
    new Typed(elements.input, {
        strings: [langData.inputPlaceholder],
        contentType: "null",
        attr: "placeholder",
        typeSpeed: 10,
        showCursor: false,
        onComplete: inputFocus,
    });
}

// Allow/forbid submit button according to input content
export function toggleSubmitButton(enabled) {
    elements.submit.classList.toggle("active", enabled);
}

// Clear input
export function clearInput() {
    elements.input.value = "";
}

// Populate input
export function populateInput(text) {
    elements.input.value = text;
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

// Expand chat window
export function expandChatWindow() {
    // Get initial positions and sizes relative to viewport
    const initialTop = elements.chatContainer.getBoundingClientRect().top;
    
    // Set initial size to match input container
    elements.chatContainer.style.width = `${elements.inputContainer.offsetWidth}px`;
    elements.chatContainer.style.height = `${elements.inputContainer.offsetHeight}px`;
    
    // Set position to fixed immediately, but maintain current position
    elements.chatContainer.style.top = `${initialTop}px`;
    elements.chatContainer.style.position = "fixed";
    
    // Force a reflow
    elements.chatContainer.offsetHeight;

    // Expand to full size and move to final position
    elements.chatContainer.style.maxWidth = "900px";
    elements.chatContainer.style.width = "90%";
    elements.chatContainer.style.maxHeight = "800px";
    elements.chatContainer.style.top = "60px";
    elements.chatContainer.style.minHeight = "265px";
    elements.chatContainer.style.height = "calc(100dvh - 111.667px)";

    // Input container styles
    elements.inputContainer.style.backgroundColor = "var(--secondary-bg-color)";
    elements.inputContainer.style.padding = "10px";

    // Fade in inner content and hide logo and prompt pills
    elements.chatWindow.style.height = "calc(100% - 80px)";
    elements.chatWindow.style.marginTop = "20px";
    elements.chatWindow.style.padding = "0px 9px 0px 15px";
    elements.chatWindow.style.opacity = "1";
    elements.logo.style.opacity = "0";
    elements.promptPillsContainer.style.display = "none";

    // Show header after slight delay
    setTimeout(() => elements.header.classList.add("visible"), 600);

    chatWindowExpanded = true;

    // Create messages container for correct scrolling
    let messagesContainer = document.createElement("div");
    messagesContainer.className = "messages-container";
    messagesContainer.setAttribute("role", "log");
    messagesContainer.setAttribute("aria-label", langData.messagesContainer);
    messagesContainer.setAttribute("aria-live", "polite");
    elements.chatWindow.appendChild(messagesContainer);
    elements.messagesContainer = messagesContainer;

    // Create disclaimer
    const disclaimer = document.createElement("div");
    disclaimer.textContent = langData.disclaimer;
    disclaimer.id = "disclaimer";
    elements.disclaimer = disclaimer;
    elements.chatWindow.appendChild(disclaimer);
}

// Animate the element in, regardless of content
function animateElement(element) {
    elements.messagesContainer.appendChild(element);
    
    // Animate the element in
    element.style.opacity = "0";
    element.style.transform = "translateY(10px)";
    element.offsetHeight;
    element.style.transition = "all 0.5s ease, color 0s, background-color 0s";
    element.style.opacity = "1";
    element.style.transform = "translateY(0)";
    
    // Scroll to bottom
    elements.chatWindow.scrollTop = elements.chatWindow.scrollHeight;
}

// Add message to chat window
export function addMessage(type, message, existingContainer = null) {
    if (type == "user") {
        const messageElement = document.createElement("div");
        messageElement.classList.add("message", "user-message");
        messageElement.textContent = message;
        messageElement.setAttribute("aria-label", langData.userMessage + message);
        animateElement(messageElement);
    } else if (type == "bot") {
        let messageElement = existingContainer;
        messageElement.removeAttribute("id");
        messageElement.innerHTML = "";
        messageElement.setAttribute("aria-label", langData.guiptResponse + message);

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
            },
        });
    } else { // Error message
        const messageElement = document.createElement("div");
        messageElement.classList.add("message", "error-message");
        messageElement.textContent = message;
        animateElement(messageElement);
    }
}

// Show loader
export function showLoader() {
    // Create loader container with bot message styling
    const loaderContainer = document.createElement("div");
    loaderContainer.id = "loader-container";
    loaderContainer.classList.add("message", "bot-message");
    
    // Create loader element
    const loaderElement = document.createElement("div");
    loaderElement.id = "loader";
    loaderElement.setAttribute("role", "status");
    loaderElement.setAttribute("aria-label", langData.loader);
    loaderContainer.appendChild(loaderElement);
    animateElement(loaderContainer);
    
    // For reuse with bot message
    return loaderContainer;
}

// Shuffle an array (Fisher-Yates)
function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
}

// Display example prompts as pills
export function displayPromptPills() {
    // Copy prompts, shuffle, and select 3
    const prompts = langData.promptPills;
    shuffleArray(prompts);
    const selectedPrompts = prompts.slice(0, 3);

    // Create pills
    selectedPrompts.forEach((promptText, index) => {
        const pill = document.createElement("div");
        pill.textContent = promptText;
        pill.classList.add("prompt-pill", "hidden");

        pill.addEventListener("pointerup", () => {
            // Disable all pills
            const allPills = document.querySelectorAll(".prompt-pill");
            allPills.forEach(pill => {
                pill.classList.add("disabled");
            });

            const chosenPrompt = pill.textContent; // Get text from clicked pill

            // Fill input and submit
            elements.input.value = chosenPrompt;
            toggleSubmitButton(true);
            elements.submit.dispatchEvent(new Event("pointerup"));
        });

        elements.promptPillsContainer.appendChild(pill);

        // Animate the pill in by removing the hidden class
        setTimeout(() => {
            pill.classList.remove("hidden");
        }, 100 * (index + 1));
    });
}

// Allow/forbid prompt pills
export function togglePromptPills(enabled) {
    const allPills = document.querySelectorAll(".prompt-pill");
    allPills.forEach(pill => pill.classList.toggle("disabled", !enabled));
}