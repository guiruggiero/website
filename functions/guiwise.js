// Imports
import * as Sentry from "@sentry/node";
import {onRequest} from "firebase-functions/v2/https";

// Initializations
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  enableLogs: true,
});
const SPLITWISE_BASE = "https://secure.splitwise.com/api/v3.0";

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
  Sentry.logger.info("[1] Guiwise started");

  // Reject requests from unknown origins
  const origin = request.headers["origin"] || request.headers["referer"] || "";
  if (!allowedOrigins.some((o) => origin.startsWith(o))) {
    Sentry.logger.warn("[1a] Unauthorized origin", {origin});

    response.status(403).send("Forbidden");

    await Sentry.flush(2000);
    return;
  }

  // Get expense from request
  const {description, amount} = request.body;
  if (!description || !amount) {
    Sentry.logger.warn("[1b] Missing fields", {description, amount});

    response.status(400).json({error: "Missing description or amount"});

    await Sentry.flush(2000);
    return;
  }

  // Build Splitwise expense object
  const expense = {
    cost: Number.parseFloat(amount).toFixed(2),
    description,
    currency_code: "USD",
    group_id: 0, // Direct expense between users
    split_equally: true,
  };

  Sentry.logger.info("[2] Expense object created", {
    description,
    amount: expense.cost,
  });

  try {
    const splitwiseResponse = await fetch(`${SPLITWISE_BASE}/create_expense`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.SPLITWISE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(expense),
    });

    const data = await splitwiseResponse.json();

    Sentry.logger.info("[3] Splitwise responded",
      {status: splitwiseResponse.status});

    response.status(splitwiseResponse.status).json(data);
  } catch (error) {
    Sentry.captureException(error, {
      extra: {description, amount},
    });

    response.status(502).json({error: error.message});
  }

  await Sentry.flush(2000);
  return;
});
