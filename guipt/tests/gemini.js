import { GEMINI_API_KEY } from "../../../secrets/guiruggiero.mjs";
import { GoogleGenerativeAI } from "@google/generative-ai";
import fs from "node:fs";
import prompt from "prompt-sync";

// const {
//     GoogleGenerativeAI,
//     HarmCategory,
//     HarmBlockThreshold,
//   } = require("@google/generative-ai");
  
const apiKey = GEMINI_API_KEY;
// console.log(apiKey);

const genAI = new GoogleGenerativeAI(apiKey);

let system_prompt = fs.readFileSync("../prompt.txt", "utf8");
// console.log(system_prompt);

const prompt_user = new prompt();

// Model setup
const model = genAI.getGenerativeModel({
  // model: "gemini-1.5-pro",
  model: "gemini-1.5-flash",
  // model: "gemini-1.0-pro",
  systemInstruction: system_prompt,
});

const generationConfig = {
  temperature: 1,
  topP: 0.95,
  topK: 64,
  maxOutputTokens: 8192,
  responseMimeType: "text/plain",
};

const safetySettings = {
  // https://ai.google.dev/gemini-api/docs/safety-settings
};

async function text_input() {
  const result = await model.generateContent("What can you do?");
  const response = await result.response;
  const text = response.text();
  console.log(text);
}

async function multi_turn() {
  const chat = model.startChat({
    generationConfig,
    // safetySettings,
  });

  console.log("Starting chat. Enter 'quit' to exit.\n");

  let input = prompt_user("User: ");

  while (input != "quit") {
    const result = await chat.sendMessage(input);
    const response = await result.response;
    const text = response.text();
    console.log("GuiPT: " + text);
    
    input = prompt_user("User: ");
  }

  console.log("\nChat terminated.");
}

// text_input();
multi_turn();