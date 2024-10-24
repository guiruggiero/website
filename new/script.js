const mainContainer = document.getElementById("main-container");
const logo = document.getElementById("logo");
const chatContainer = document.getElementById("chat-container");
const chatWindow = document.getElementById("chat-window");
const chatInput = document.getElementById("chat-input");
const submitBtn = document.getElementById("submit-btn");
const inputContainer = document.getElementById("input-container");

let isExpanded = false;

function expandChatWindow() {
    if (!isExpanded) {
        // Set initial size to match the search bar
        chatContainer.style.width = `${inputContainer.offsetWidth}px`;
        chatContainer.style.height = `${inputContainer.offsetHeight}px`;
        
        // Force a reflow
        chatContainer.offsetHeight;
        
        // Expand to full size
        chatContainer.style.width = 'min(90vw, 900px)';
        chatContainer.style.height = 'min(80vh, 800px)';
        // chatContainer.style.minHeight = '300px';
        // chatContainer.style.minWidth = '280px';
        chatContainer.style.maxHeight = '600px'; // calc(100% - 70px)
        chatContainer.style.maxWidth = '800px';
        
        // Bring back input container to view
        inputContainer.style.padding = '10px';
        inputContainer.style.backgroundColor = '#262626';

        setTimeout(() => {
            chatWindow.style.height = 'calc(100% - 70px)';
            chatWindow.style.opacity = '1';
            chatWindow.style.padding = '15px';
            logo.style.opacity = '0';
        }, 50);

        isExpanded = true;
    }
}

function addMessage(message, isUser) {
    const messageElement = document.createElement("div");
    messageElement.classList.add("message");
    messageElement.classList.add(isUser ? "user-message" : "bot-message");
    messageElement.textContent = message;

    // Add animation class for smooth entry
    messageElement.style.opacity = "0";
    messageElement.style.transform = "translateY(20px)";
    
    chatWindow.appendChild(messageElement);
    
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
    const message = chatInput.value;
    if (message.trim() === "") return;

    expandChatWindow();
    addMessage(message, true);

    // Simulate bot response
    setTimeout(() => {
        addMessage("This is a simulated response from the LLM chatbot.", false);
    }, 1000);

    chatInput.value = "";
}

submitBtn.addEventListener("click", handleSubmit);

chatInput.addEventListener("keypress", (e) => {
    if (e.key === "Enter") handleSubmit();
});