// Imports
import * as Sentry from "@sentry/node";
import {GoogleGenAI} from "@google/genai";
import {LangfuseClient} from "@langfuse/client";
import sanitizeHtml from "sanitize-html";
import {onRequest} from "firebase-functions/v2/https";

// Initializations
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  enableLogs: true,
});
const ai = new GoogleGenAI({apiKey: process.env.GEMINI_API_KEY});
const langfuse = new LangfuseClient({
  secretKey: process.env.LANGFUSE_SECRET_KEY,
  publicKey: process.env.LANGFUSE_PUBLIC_KEY,
  baseUrl: "https://us.cloud.langfuse.com",
});

// Model safety settings
const safetySettings = [
  {category: "HARM_CATEGORY_HARASSMENT",
    threshold: "BLOCK_LOW_AND_ABOVE"},
  {category: "HARM_CATEGORY_HATE_SPEECH",
    threshold: "BLOCK_LOW_AND_ABOVE"},
  {category: "HARM_CATEGORY_SEXUALLY_EXPLICIT",
    threshold: "BLOCK_LOW_AND_ABOVE"},
  {category: "HARM_CATEGORY_DANGEROUS_CONTENT",
    threshold: "BLOCK_MEDIUM_AND_ABOVE"},
];

// Model configuration
const modelConfig = {
  model: "gemini-flash-lite-latest",
  config: {
    maxOutputTokens: 400,
    responseMimeType: "text/plain",
    safetySettings,
    thinkingConfig: {
      thinkingLevel: "minimal",
    },
  },
};

// Sanitization options - removes all HTML tags/attributes
const sanitizeOptions = {allowedTags: [], allowedAttributes: {}};

// Sanitize potentially harmful characters
function sanitizeInput(input) {
  let sanitizedInput = input.replace(/\s+/g, " "); // Normalize whitespace
  sanitizedInput = sanitizedInput.trim(); // Remove whitespace from both ends
  sanitizedInput = sanitizeHtml(
    sanitizedInput,
    sanitizeOptions,
  );
  return sanitizedInput;
};

// Assess guardrails
const validationErrors = Object.freeze({
  SUCCESS: "OK",
  TOO_LONG: "errorTooLong",
  FORBIDDEN_CHARS: "errorForbiddenChars",
});
function validateInput(input) {
  // Length limit
  if (input.length > 200) return validationErrors.TOO_LONG;

  // Character allowlist — blocks $%&
  if (!/^[A-Za-zÀ-ÖØ-öø-ÿ0-9\s.,!?;:'’"()+*=@/-]+$/.test(input)) {
    return validationErrors.FORBIDDEN_CHARS;
  }

  return validationErrors.SUCCESS;
};

// Allowed origins
const allowedOrigins = [
  "http://guiruggiero.com",
  "https://guiruggiero.com",
  "https://probable-firmly-gobbler.ngrok-free.app",
];

// Function configuration
const functionConfig = {
  cors: allowedOrigins,
  maxInstances: 5,
  timeoutSeconds: 8,
};

export const guipt = onRequest(functionConfig, async (request, response) => {
  Sentry.logger.info("[1] GuiPT started");

  // Reject requests from unknown origins
  const origin = request.headers["origin"] || request.headers["referer"] || "";
  if (!allowedOrigins.some((o) => origin.startsWith(o))) {
    Sentry.logger.warn("[1a] Unauthorized origin", {origin});

    response.status(403).send("Forbidden");

    await Sentry.flush(2000);
    return;
  }

  // Handle warm-up pings
  if (request.body?.ping === true) {
    Sentry.logger.info("[1b] Warm-up ping received");

    response.status(200).send("pong");

    await Sentry.flush(2000);
    return;
  }

  // Get user message from request
  let userMessage = request.body?.message;
  if (typeof userMessage !== "string" || userMessage.trim() === "") {
    userMessage = "Hi! In a sentence, who are you and what can you do?";
  }

  // Sanitize and validate input
  const sanitizedMessage = sanitizeInput(userMessage);
  const validationResult = validateInput(sanitizedMessage);

  // Return error message if input doesn't pass validation
  if (validationResult !== validationErrors.SUCCESS) {
    Sentry.logger.error("[1b] Validation failed", {validationResult});

    response.status(400).send(validationResult);

    await Sentry.flush(2000);
    return;
  }

  // Get chat history
  const chatHistory = request.body?.history || [];
  let failedStep = "langfuseFetch";

  try {
    // Get model prompt
    const promptResponse = await langfuse.prompt.get("GuiPT", {
      cacheTtlSeconds: 180, // 3m cache
    });
    const instructions = promptResponse.prompt;

    Sentry.logger.info("[2] Prompt fetched", {
      version: promptResponse.version,
      prompt: instructions.slice(0, 200),
    });

    // Initialize chat
    const chat = ai.chats.create({
      ...modelConfig,
      config: {
        ...modelConfig.config,
        systemInstruction: instructions,
      },
      history: chatHistory,
    });

    failedStep = "geminiCall";
    Sentry.logger.info("[3] Ready for Gemini call", {sanitizedMessage});

    // Call Gemini API
    const result = await chat.sendMessage({message: sanitizedMessage});
    const guiptResponse = result.text;

    Sentry.logger.info("[4] GuiPT done", {guiptResponse});

    response.status(200).type("text/plain").send(guiptResponse);
  } catch (error) {
    Sentry.captureException(error, {
      contexts: {
        requestDetails: {
          failedStep,
          sanitizedMessage,
          historyLength: chatHistory.length,
          errorStatus: error.status ?? null,
          errorCode: error.code ?? null,
        },
      },
    });

    response.status(500).json({
      errorName: error.name,
      errorMessage: error.message,
    });
  }

  await Sentry.flush(2000);
  return;
});
