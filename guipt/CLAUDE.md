# GuiPT Cloud Function Reference

## Architecture

`index.js` is the entrypoint and holds the whole `guipt` Cloud Function — single function, no re-export layer. Sentry init happens here too. Deploy with `npm run deploy`.

Receives `{message, history}` — stateless, history is passed in from the client — then:

1. Sanitizes and validates input
2. Fetches the system prompt from Langfuse (3-minute cache)
3. Calls Google Gemini (`gemini-flash-lite-latest`, temp 0.4, max 400 tokens) with safety filters (harassment/hate/explicit at `LOW_AND_ABOVE`, dangerous content at `MEDIUM_AND_ABOVE`)
4. Returns a plain-text response

**Access**: CORS restricted to `guiruggiero.com` and the ngrok dev URL, plus a server-side origin check that returns 403 for unknown origins.

**Limits**: max 5 instances, 8-second function timeout. The client (`modules/guipt.js`) enforces a 22-second timeout, raced against the axios 6-second retry chain. When changing the API contract (request/response shape, error codes, timeouts), update both `guipt/index.js` and `modules/guipt.js` together.

**Required env vars** (set in Firebase Console, never in source): `GEMINI_API_KEY`, `LANGFUSE_SECRET_KEY`, `LANGFUSE_PUBLIC_KEY`, `SENTRY_DSN`.

### Firestore Logging

Chat sessions are logged to Firestore in collection `dev` (ngrok) or `v1` (everything else, production included). The environment comes from the same URL check as module loading — `location.href.includes("ngrok")` in `modules/firebase.js`, not the hostname — so a plain `localhost` page writes to `v1`, not `dev`. `createLog()` fires on the first chat turn; `logTurn()` appends on subsequent turns.

## Prompt Management

`prompt.md` is the local copy of the GuiPT system prompt (gitignored). The live prompt is on Langfuse; `prompt.md` exists so Claude Code always has the full prompt in context. Use `npm run prompt-pull` / `npm run prompt-push` to sync; the scripts require `LANGFUSE_SECRET_KEY` and `LANGFUSE_PUBLIC_KEY` in `.env` (gitignored). Always apply changes to the system prompt, let the user know, and offer to push to Langfuse; but never mention it in the commit message.

**A push is not a deploy.** `prompt-push` creates the version with `labels: []`, deliberately omitting `"production"`, so the live prompt doesn't change until the version is promoted in the Langfuse UI. And because `prompt-pull` fetches the production-labelled version, pulling before promoting overwrites `prompt.md` with the old live prompt — losing the local edits you just pushed.

## ESLint

Uses the Google style config, which enforces a max line length of 80 characters.