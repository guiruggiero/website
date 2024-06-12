import { GEMINI_API_KEY } from "../../../secrets/guiruggiero.mjs";
import { GoogleGenerativeAI } from "@google/generative-ai";
import fs from "node:fs";
import prompt from "prompt-sync";

// Initializations
const apiKey = GEMINI_API_KEY;
// console.log(apiKey);

const genAI = new GoogleGenerativeAI(apiKey);

const prompt_user = new prompt();

// Model setup
// const model_chosen = "gemini-1.5-pro";
const model_chosen = "gemini-1.5-flash";
// const model_chosen = "gemini-1.0-pro";

let instructions = fs.readFileSync("../prompt.txt", "utf8");
// console.log(instructions);

const generationConfig = {
  temperature: 1,
  topP: 0.95,
  topK: 64,
  maxOutputTokens: 8192,
  responseMimeType: "text/plain",
};

const safetySettings = {
  // https://ai.google.dev/gemini-api/docs/safety-settings
  // https://github.com/google-gemini/generative-ai-js/blob/main/samples/node/advanced-text.js
};

const model = genAI.getGenerativeModel({
  model: model_chosen,
  systemInstruction: instructions,
  generationConfig,
  // safetySettings,
});

// Simple text generation
// async function text_input() {
//   const result = await model.generateContent("What can you do?");
//   const response = await result.response;
//   const text = response.text();
//   console.log(text);
// }

// text_input();

// Multi-turn chat
async function multi_turn() {
  const chat = model.startChat();

  console.log("Starting chat. Enter 'quit' to exit.\n");

  let input = prompt_user("User: ");

  while (input != "quit") {
    const result = await chat.sendMessage(input);
    const response = await result.response;
    const text = response.text();
    console.log("GuiPT: " + text);
    
    input = prompt_user("User: ");
  }

  console.log("\nChat terminated.\n");

  // Check if context is preserved
  // let history = await chat.getHistory()
  // console.log(JSON.stringify(history, null, 2))
}

multi_turn();