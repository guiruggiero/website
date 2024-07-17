// Initializations
const cloudFunctionURL = "https://us-central1-guiruggiero.cloudfunctions.net/guipt"; // TODO: env variable
let chatHistory = [];

// Fetches elements
const submitButton = document.querySelector("#submit");
const outputElement = document.querySelector("#result");
const inputElement = document.querySelector("input");

async function getMessage() {
    await axios
        .post(cloudFunctionURL, null, { params: {
            history: chatHistory,
            prompt: inputElement.value,
        }})
        .then((response) => {
            const guiptResponse = response.data;

            // Saves turns
            chatHistory.push({role: "user", parts: [{text: inputElement.value}]});
            chatHistory.push({role: "model", parts: [{text: guiptResponse}]});
            
            // Updates UI
            outputElement.textContent = guiptResponse;
            inputElement.value = "";
        })
        .catch((error) => {
            console.error("Error: ", error);
        });
}

// Events
submitButton.addEventListener("click", getMessage);
inputElement.addEventListener("keyup", (e) => {
    if (e.key === "Enter") {
        getMessage();
    }
});