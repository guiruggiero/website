# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev     # Local dev server on port 8082
npm run lint    # ESLint across JS, HTML, CSS, YAML, Markdown
npm run tunnel  # ngrok tunnel for local testing with mobile/external devices
```

No build step required locally — minification runs in CI only (see `.github/workflows/minification.yml`).

## Architecture

This is a **static vanilla JavaScript website** — no framework, no bundler, no transpilation. All JS is written as ES6 modules and loaded directly from HTML via `<script type="module">`. The backend API is a Firebase Cloud Function on `guipt`. When changing the API contract (request/response shape, error codes, timeouts), both repos need updating together.

### Pages and Modules

- `index.html` — Main page; loads the GuiPT AI chat interface
- `resume.html` — Portfolio/resume page
- Various redirect pages (`linkedin.html`, `github.html`, etc.) — Use `modules/redirect.js` or meta redirects
- `modules/` — 10 ES6 modules for the chat interface:
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

### Dev vs. Production Loading

Scripts auto-detect the environment at runtime. On `localhost` or ngrok, `.js` modules are loaded; on production, `.min.js` is used. This means the file a page loads is determined by the script tag in the HTML — no webpack aliases or env flags.

### API Integration

GuiPT messages are sent to `/guipt` Cloud Function (separate repo). The client enforces a 16-second timeout (race against the axios 4-second retry chain). Both repos must be updated together when changing the request/response contract.

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

ESLint is configured to lint JS, HTML, CSS, YAML, and Markdown. Run `npm run lint` before pushing. The CI pipeline does not run lint automatically — it only minifies and deploys.

<!-- TODO: ESLint is currently broken — `@stylistic/eslint-plugin` fails to load due to an `estraverse` ESM incompatibility. Run `npm install` or update `@stylistic/eslint-plugin` to fix before linting. -->

## Sentry
**Sentry:** Errors logged to the `website` project (`WEBSITE-*` issue IDs).
