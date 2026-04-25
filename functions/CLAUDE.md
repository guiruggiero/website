# Cloud Functions Reference

## Architecture

`index.js` is the entrypoint — it just re-exports from `guipt.js` and `guiwise.js`. Each function file handles its own Sentry init (idempotent). Deploy with `npm run deploy` (all functions) or per-function scripts.

### GuiPT (`guipt.js`)

Receives `{message, history}` (stateless — history is passed in from the client), sanitizes and validates input, fetches the system prompt from Langfuse (3-minute cache), calls Google Gemini (`gemini-flash-lite-latest`, temp 0.4, max 400 tokens) with safety filters (harassment/hate/explicit at `LOW_AND_ABOVE`, dangerous content at `MEDIUM_AND_ABOVE`), and returns a plain-text response. CORS restricted to `guiruggiero.com` and the ngrok dev URL; also enforces a server-side origin check (returns 403 for unknown origins). Required env vars (set in Firebase Console, never in source): `GEMINI_API_KEY`, `LANGFUSE_SECRET_KEY`, `LANGFUSE_PUBLIC_KEY`, `SENTRY_DSN`. Max 5 instances, 8-second timeout. The client (`modules/guipt.js`) enforces a 22-second timeout (race against the axios 6-second retry chain). When changing the API contract (request/response shape, error codes, timeouts), update both `functions/guipt.js` and `modules/guipt.js` together.

### Guiwise (`guiwise.js`)

Receives `{description, amount}`, proxies to the Splitwise API (`POST /create_expense`) as a direct USD expense split, and returns the Splitwise API response as JSON. CORS restricted to `guiruggiero.com` and the ngrok dev URL; also enforces a server-side origin check (returns 403 for unknown origins). Required env vars (set in Firebase Console, never in source): `SPLITWISE_API_KEY`, `SENTRY_DSN`. Max 2 instances, 10-second timeout.

### Firestore Logging

Chat sessions are logged to Firestore in collection `dev` (localhost/ngrok) or `v1` (production). Environment is detected by hostname. `createLog()` fires on the first chat turn; `logTurn()` appends on subsequent turns.

## Prompt Management

`guipt-prompt.md` is the GuiPT system prompt managed via the scripts above and excluded from regular commits. Always perform changes to the system prompt, but never consider it in the commit message. Scripts require `LANGFUSE_SECRET_KEY` and `LANGFUSE_PUBLIC_KEY` in `.env` (gitignored).

## ESLint

Uses the Google style config, which enforces a max line length of 80 characters.