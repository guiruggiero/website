import { GEMINI_API_KEY } from "../../../secrets/guiruggiero.mjs";
import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from "@google/generative-ai";

import fs from "node:fs";
import prompt from "prompt-sync";

import { firebaseConfig } from "../../../secrets/guiruggiero.mjs";
import { initializeApp } from "firebase/app";
import { getFirestore, collection, addDoc, updateDoc, doc, setDoc, Timestamp } from 'firebase/firestore/lite';

// Initializations
const apiKey = GEMINI_API_KEY;
// console.log(apiKey);

const genAI = new GoogleGenerativeAI(apiKey);

const prompt_user = new prompt();

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const mode = "dev";

// Model setup
// const model_chosen = "gemini-1.5-pro";
const model_chosen = "gemini-1.5-flash";
// const model_chosen = "gemini-1.0-pro";

let instructions = fs.readFileSync("../prompt.txt", "utf8");
// console.log(instructions);

const generationConfig = {
  temperature: 0.7, // default 1
  topP: 0.95,
  topK: 40, // default 40
  maxOutputTokens: 400,
  responseMimeType: "text/plain",
};

const safetySettings = [
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
    threshold: HarmBlockThreshold.BLOCK_LOW_AND_ABOVE,
  },
];

const model = genAI.getGenerativeModel({
  model: model_chosen,
  systemInstruction: instructions,
  generationConfig,
  safetySettings,
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

  let turn_count = 1;
  let input = prompt_user("User: ");
  const start = Timestamp.now();

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