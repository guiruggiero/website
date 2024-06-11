import { GEMINI_API_KEY } from "../../../secrets/guiruggiero.mjs";
import { GoogleGenerativeAI } from "@google/generative-ai";
import fs from "node:fs";

// const {
//     GoogleGenerativeAI,
//     HarmCategory,
//     HarmBlockThreshold,
//   } = require("@google/generative-ai");
  
const apiKey = GEMINI_API_KEY;
// console.log(apiKey);
const genAI = new GoogleGenerativeAI(apiKey);

// var fs = require("fs");
var prompt = fs.readFileSync("../prompt.txt", "utf8");
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

async function run() {
  const chatSession = model.startChat({
    generationConfig,
  // safetySettings: Adjust safety settings
  // See https://ai.google.dev/gemini-api/docs/safety-settings
  });

  const result = await chatSession.sendMessage("What can you do?");
  console.log(result.response.text());
}

run();