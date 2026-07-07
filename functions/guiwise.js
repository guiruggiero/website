// Imports
import * as Sentry from "@sentry/node";
import {onRequest} from "firebase-functions/v2/https";
import axios from "axios";

// Initializations
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  enableLogs: true,
});

// Axios instance for Guiddleware
const guiddlewareClient = axios.create({
  baseURL: process.env.GUIDDLEWARE_URL,
  timeout: 10000, // 10s
  headers: {
    "Authorization": `Bearer ${process.env.GUIDDLEWARE_SECRET_GUIWISE}`,
    "Content-Type": "application/json",
  },
});

// Allowed origins
const allowedOrigins = [
  "https://guiruggiero.com",
  "https://probable-firmly-gobbler.ngrok-free.app",
];

// Function configuration
const functionConfig = {
  cors: allowedOrigins,
  maxInstances: 2,
  timeoutSeconds: 10,
};

export const guiwise = onRequest(functionConfig, async (request, response) => {
  Sentry.logger.info("[1] Guiwise started", {
    path: request.path, method: request.method,
  });

  // Reject requests from unknown origins
  const origin = request.headers["origin"] || request.headers["referer"] || "";
  if (!allowedOrigins.some((o) => origin.startsWith(o))) {
    Sentry.logger.warn("[1a] Unauthorized origin", {origin});

    response.status(403).send("Forbidden");

    await Sentry.flush(2000);
    return;
  }

  // Thin proxy to Guiddleware: this function's only job is to hold the
  // real GUIDDLEWARE_SECRET_GUIWISE server-side, since the website repo
  // (and its built/minified JS) is public
  try {
    let guiddlewareResponse;

    if (request.method === "GET" && request.path === "/friends") {
      guiddlewareResponse = await guiddlewareClient.get("/splitwise/friends");
    } else if (request.method === "GET" && request.path === "/groups") {
      guiddlewareResponse = await guiddlewareClient.get("/splitwise/groups");
    } else if (request.method === "POST" &&
      (request.path === "/" || request.path === "")) {
      guiddlewareResponse = await guiddlewareClient.post(
        "/splitwise/expenses", {...request.body, source: "Guiwise"});
    } else {
      response.status(404).json({error: "Not found"});

      await Sentry.flush(2000);
      return;
    }

    Sentry.logger.info("[2] Guiddleware responded", {
      status: guiddlewareResponse.status,
    });

    response.status(guiddlewareResponse.status).json(guiddlewareResponse.data);
  } catch (error) {
    Sentry.captureException(error, {
      extra: {path: request.path, method: request.method},
    });

    response.status(error.response?.status ?? 502)
      .json(error.response?.data ?? {error: error.message});
  }

  await Sentry.flush(2000);
});
