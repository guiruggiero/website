document.getElementById('submit-btn').addEventListener('click', function() {
  document.getElementById('welcome-screen').classList.add('hidden');
  document.getElementById('chat-screen').classList.remove('hidden');
  const inputField = document.getElementById('input-field');
  addChatMessage("user", inputField.value);
  addChatMessage("assistant", "Hello! How can I help you today?");
  inputField.value = '';
});

document.getElementById('chat-submit-btn').addEventListener('click', function() {
  const chatInput = document.getElementById('chat-input');
  addChatMessage("user", chatInput.value);
  // Here you would implement the logic to get a response from your assistant.
  // For this example, we will just echo the user's message.
  setTimeout(() => {
      addChatMessage("assistant", `You said: "${chatInput.value}"`);
  }, 500);
  chatInput.value = '';
});

function addChatMessage(sender, message) {
  const chatBox = document.getElementById('chat-box');
  const messageElement = document.createElement('div');
  messageElement.classList.add('chat-message', sender);
  messageElement.textContent = message;
  chatBox.appendChild(messageElement);
  chatBox.scrollTop = chatBox.scrollHeight;
}

// Styling chat messages
const style = document.createElement('style');
style.innerHTML = `
  .chat-message {
      padding: 10px;
      margin: 10px 0;
      border-radius: 4px;
  }
  .chat-message.user {
      background-color: #e1f5fe;
      text-align: right;
  }
  .chat-message.assistant {
      background-color: #f1f1f1;
      text-align: left;
  }
`;
document.head.appendChild(style);