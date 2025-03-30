/* eslint-disable max-len */

// Backup of the Firebase Function used for Who-Gui-Ni (dedicated prompt because of different name)

const {GoogleGenerativeAI, HarmCategory, HarmBlockThreshold} = require("@google/generative-ai");
const fs = require("fs");
const {onRequest} = require("firebase-functions/v2/https");

// Initializations
const apiKey = process.env.GEMINI_API_KEY;
const genAIWhoguini = new GoogleGenerativeAI(apiKey);

// Gemini variation - "gemini-1.5-flash", "gemini-1.5-pro", "gemini-1.0-pro"
const modelChosenWhoguini = "gemini-1.5-flash";

// Get prompt instructions from file
const instructionsWhoguini = fs.readFileSync("prompt-whoguini.txt", "utf8");
// console.log(instructions);

// Model configuration
const generationConfigWhoguini = {
  temperature: 0.7, // default 1
  topP: 0.95, // default 0.95
  topK: 40, // default 40
  maxOutputTokens: 400,
  responseMimeType: "text/plain",
};

// Model safety settings
const safetySettingsWhoguini = [
  {
    category: HarmCategory.HARM_CATEGORY_HARASSMENT,
    threshold: HarmBlockThreshold.BLOCK_LOW_AND_ABOVE,
  },
  {
    category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
    threshold: HarmBlockThreshold.BLOCK_LOW_AND_ABOVE,
  },
  {
    category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
    threshold: HarmBlockThreshold.BLOCK_LOW_AND_ABOVE,
  },
  {
    category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
    threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
  },
];

// Model constructor
const modelWhoguini = genAIWhoguini.getGenerativeModel({
  model: modelChosenWhoguini,
  systemInstruction: instructionsWhoguini,
  generationConfigWhoguini,
  safetySettingsWhoguini,
});

exports.whoguini = onRequest({cors: true}, async (request, response) => {
  // Get chat history from request
  let chatHistory = request.query.history;
  if (!chatHistory) {
    chatHistory = [];
  }
  // console.log("chatHistory: " + chatHistory);

  // Initialize the chat
  const chat = modelWhoguini.startChat({history: chatHistory});

  // Get user prompt from request
  let userInput = request.query.prompt;
  if (!userInput) {
    userInput = "Who are you and what can you do?";
  }

  // Gemini API call
  const result = await chat.sendMessage(userInput);
  const whoguiniResponse = result.response;
  const whoguiniResponseText = whoguiniResponse.text();

  // Returns model response back to API caller
  response.send(whoguiniResponseText);
});
