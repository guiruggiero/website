import { GEMINI_API_KEY } from "../../../secrets/guiruggiero.mjs";
import { ChatSession, GoogleGenerativeAI } from "@google/generative-ai";
import fs from "node:fs";

// const {
//     GoogleGenerativeAI,
//     HarmCategory,
//     HarmBlockThreshold,
//   } = require("@google/generative-ai");
  
const apiKey = GEMINI_API_KEY;
// console.log(apiKey);
const genAI = new GoogleGenerativeAI(apiKey);

let prompt = fs.readFileSync("../prompt.txt", "utf8");
// console.log(prompt);

const model = genAI.getGenerativeModel({
  model: "gemini-1.5-pro",
  // model: "gemini-1.5-flash",
  systemInstruction: prompt,
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

// async function chat() { // TODO
//   // The Gemini 1.5 models are versatile and work with multi-turn conversations (like chat)
//   const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash"});

//   const chat = model.startChat({
//     history: [
//       {
//         role: "user",
//         parts: [{ text: "Hello, I have 2 dogs in my house." }],
//       },
//       {
//         role: "model",
//         parts: [{ text: "Great to meet you. What would you like to know?" }],
//       },
//     ],
//     generationConfig: {
//       maxOutputTokens: 100,
//     },
//   });

//   const msg = "How many paws are in my house?";

//   const result = await chat.sendMessage(msg);
//   const response = await result.response;
//   const text = response.text();
//   console.log(text);
// }

text_input();
// chat();