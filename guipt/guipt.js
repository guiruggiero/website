// Initializations
const cloudFunctionURL = "https://us-central1-guiruggiero.cloudfunctions.net/guipt";
let chatHistory = [];
let turnCount = 0;
let chatStart, chatID;

async function GuiPT() {
    try {
        // Get start time for logs
        chatStart = Timestamp.now().toDate();

        // Get and validate input
        const input = inputElement.value;
        const sanitizedInput = sanitizeInput(input);
        const validationResult = validateInput(sanitizedInput);

        // Input validation
        // If previous message is not an error, stop but don't erase it
        if (validationResult.assessment == "Empty" && outputElement.textContent.substring(0, 5) != "Error") return;
        
        // Other guardrails
        if (validationResult.assessment != "OK") {
            if (validationResult.assessment == "Too long") clearInput(); // Likely copy/paste, erase input
            displayText(validationResult.message);
            return;
        }

        // Update UI to indicate loading
        closeKeyboard();
        clearInput();
        displayText("...");

        // Handle timeout
        const timeout = 61000;
        let timeoutFunction = setTimeout(() => {
            displayText("Error: request timed out, GuiPT might be AFK. Can you please try again?");
        }, timeout);

        await axios
            // Call GuiPT
            .post(cloudFunctionURL, null, { params: {
                history: chatHistory,
                prompt: sanitizedInput,
            }})

            // Successful response
            .then(async (response) => {
                // Clear timeout
                clearTimeout(timeoutFunction);

                // Get and show GuiPT response
                const guiptResponse = response.data;
                displayText(guiptResponse);

                // Save chat history
                chatHistory.push({role: "user", parts: [{text: sanitizedInput}]});
                chatHistory.push({role: "model", parts: [{text: guiptResponse}]});
                
                // Log chat/turn
                turnCount++;
                let chatEnd = Timestamp.now().toDate();
                const turnData = {
                    user: sanitizedInput,
                    model: guiptResponse
                };
                if (turnCount == 1) {
                    chatID = await createLog(chatStart, turnData);
                    console.log(chatID); // TODO
                } else {
                    await logTurn(chatID, turnCount, turnData, chatEnd);
                };
            });
    }
    
    // Handle errors
    catch (error) {
        clearTimeout(timeoutFunction);
        console.error("Error: ", error);
        displayText("Error: oops, something went wrong! Can you please try again?");
    };
};