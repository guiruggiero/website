import { GEMINI_API_KEY } from "../../../secrets/guiruggiero.mjs";
import { GoogleGenerativeAI } from "@google/generative-ai";
import fs from "node:fs";
import prompt from "prompt-sync";

const apiKey = GEMINI_API_KEY;
// console.log(apiKey);

const genAI = new GoogleGenerativeAI(apiKey);

const prompt_user = new prompt();

// Model setup
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
  // model: "gemini-1.5-pro",
  model: "gemini-1.5-flash",
  // model: "gemini-1.0-pro",
  systemInstruction: instructions,
  generationConfig,
  // safetySettings,
});

// async function text_input() {
//   const result = await model.generateContent("What can you do?");
//   const response = await result.response;
//   const text = response.text();
//   console.log(text);
// }

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
  // let history = await chat.getHistory()
  // console.log(JSON.stringify(history, null, 2))
}

// text_input();
multi_turn();