# CLAUDE.md 

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev     # Local dev server on port 8082
npm run lint    # ESLint across JS, HTML, CSS, YAML, Markdown
npm run tunnel  # ngrok tunnel for local testing with mobile/external devices
```

All commands below run from `functions/`:

```bash
npm run lint            # ESLint check (also runs automatically before deploy)
npm run deploy          # Deploy all Cloud Functions (runs lint first via predeploy hook)
npm run deploy-guipt    # Deploy only the GuiPT function
npm run deploy-guiwise  # Deploy only the Guiwise function
```

No build step required locally — minification runs in CI only (see `.github/workflows/minification.yml`).

## Architecture

This is a **static vanilla JavaScript website** — no framework, no bundler, no transpilation. All JS is written as ES6 modules and loaded directly from HTML via `<script type="module">`. The backend API is a Firebase Cloud Function in `functions/`.

### Pages and Modules

- `index.html` — Main page; loads the GuiPT AI chat interface
- `resume.html` — Portfolio/resume page
- Various utility pages (`resume-pdf.html`, `scheduling.html`, etc.) using embedded content
- Various redirect pages (`linkedin.html`, `github.html`, etc.) using `modules/redirect.js` or meta redirects
- `modules/` — ES6 modules:
  - `main.js` — Orchestrates chat: event listeners, turn flow, history management
  - `ui.js` — DOM manipulation, chat window expand/collapse, loader
  - `guipt.js` — API call to the GuiPT Cloud Function with axios + retry
  - `firebase.js` — Firestore Lite logging (`createLog`, `logTurn`)
  - `validation.js` — Input sanitization, length check, rate limiting (5 msg/min)
  - `localization.js` — i18n, auto-detects browser locale
  - `theme-toggle.js` — Dark/light mode, persisted in localStorage
  - `sentry.js` — Error tracking initialization
  - `cookie-banner.js` — Google Analytics consent
  - `redirect.js` — URL redirection helper
  - `splitwise.js` — Guiwise expense form; calls the `guiwise` Firebase Cloud Function

### Dev vs. Production Loading

Scripts auto-detect the environment at runtime. On `localhost` or ngrok, `.js` modules are loaded; on production, `.min.js` is used. This means the file a page loads is determined by the script tag in the HTML — no webpack aliases or env flags.

### Cloud Functions

`functions/` contains all Firebase Cloud Functions. `index.js` is the entrypoint — it just re-exports from `guipt.js` and `guiwise.js`. Each function file handles its own Sentry init (idempotent). Deploy with `npm run deploy` (all functions) or per-function scripts from `functions/`.

**GuiPT** (`functions/guipt.js`): Receives `{message, history}` (stateless — history is passed in from the client), sanitizes and validates input, fetches the system prompt from Langfuse (3-minute cache), calls Google Gemini (`gemini-flash-lite-latest`, temp 0.4, max 400 tokens) with safety filters (harassment/hate/explicit at `LOW_AND_ABOVE`, dangerous content at `MEDIUM_AND_ABOVE`), and returns a plain-text response. CORS-enabled. Required env vars (set in Firebase Console, never in source): `GEMINI_API_KEY`, `LANGFUSE_SECRET_KEY`, `LANGFUSE_PUBLIC_KEY`, `SENTRY_DSN`. Max 5 instances, 8-second timeout. The client (`modules/guipt.js`) enforces a 16-second timeout (race against the axios 4-second retry chain). When changing the API contract (request/response shape, error codes, timeouts), update both `functions/guipt.js` and `modules/guipt.js` together.

**Guiwise** (`functions/guiwise.js`): Receives `{description, amount}`, proxies to the Splitwise API (`POST /create_expense`) as a direct USD expense split, and returns the Splitwise API response as JSON. CORS-enabled. Required env vars (set in Firebase Console, never in source): `SPLITWISE_API_KEY`, `SENTRY_DSN`. Max 5 instances, 10-second timeout.

### Firestore Logging

Chat sessions are logged to Firestore in collection `dev` (localhost/ngrok) or `v1` (production). Environment is detected by hostname. `createLog()` fires on the first chat turn; `logTurn()` appends on subsequent turns.

### Deployment Pipeline

Pushing to the `live` branch triggers the minification workflow:
1. HTML → html-minifier-next
2. CSS → lightningcss-cli
3. JS → terser (with source maps)
4. Source maps uploaded to Sentry
5. Minified output force-pushed to `live-min` branch
6. GitHub Pages serves from `live-min`; Cloudflare cache is then purged

The `main` branch is for development; `live` is the pre-minification source; `live-min` is what's actually served at guiruggiero.com.

### Localization

All UI strings live in `locales/en.js` and `locales/pt.js`. When adding new UI text, add keys to both locale files. The language is auto-detected from `navigator.language`.

### Linting

ESLint is configured to lint JS, HTML, CSS, YAML, and Markdown. Run `npm run lint` before pushing. The CI pipeline does not run lint automatically — it only minifies and deploys. `functions/` uses the ESLint Google style config which enforces a max line length of 80 characters.

<!-- TODO: fix ESLint - currently broken, `@stylistic/eslint-plugin` fails to load due to an `estraverse` ESM incompatibility. Run `npm install` or update `@stylistic/eslint-plugin` to fix before linting. -->

## Sentry
**Sentry:** Errors logged to the `website` project (`WEBSITE-*` issue IDs).
