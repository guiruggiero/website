/*
 * Install the Generative AI SDK
 *
 * $ npm install @google/generative-ai
 *
 * See the getting started guide for more information
 * https://ai.google.dev/gemini-api/docs/get-started/node
 */

// https://aistudio.google.com/app/prompts/1LX_TrePVoOAqZeIMJYNYGE7-lCQSTXAH

const {
    GoogleGenerativeAI,
    HarmCategory,
    HarmBlockThreshold,
  } = require("@google/generative-ai");
  
  const apiKey = process.env.GEMINI_API_KEY; // Import from Secrets
  const genAI = new GoogleGenerativeAI(apiKey);
  
  var fs = require('fs');
  var data = fs.readFileSync('prompt.txt', 'utf8');
  console.log(data);

  const model = genAI.getGenerativeModel({
    model: "gemini-1.5-pro",
    systemInstruction: data ,
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
  
    const result = await chatSession.sendMessage("INSERT_INPUT_HERE");
    console.log(result.response.text());
  }
  
  run();