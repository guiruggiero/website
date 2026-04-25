# Website Codebase Reference

## Architecture

This is a **static vanilla JavaScript website** — no framework, no bundler, no transpilation. All JS is written as ES6 modules and loaded directly from HTML via `<script type="module">`. The backend API is a Firebase Cloud Function in `functions/`.

### Pages and Modules

- `index.html` — Main page; loads the GuiPT AI chat interface
- `resume.html` — Portfolio/resume page
- Various external utility pages (`resume-pdf.html`, `scheduling.html`, etc.) using embedded content and with `noindex` meta tag
- Internal/personal utility pages (`splitwise.html`, `onairsign.html`) with `noindex` meta tag and no GTM or Google Analytics
- Various redirect pages (`linkedin.html`, `github.html`, etc.) using `modules/redirect.js`
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

### Localization

All UI strings live in `locales/en.js` and `locales/pt.js`. When adding new UI text, add keys to both locale files. The language is auto-detected from `navigator.language`.

### Linting

ESLint is configured to lint JS, HTML, CSS, YAML, and Markdown. Run `npm run lint` before pushing. The CI pipeline does not run lint automatically — it only minifies and deploys.

## Deployment Pipeline

Pushing to the `live` branch triggers the minification workflow:
1. HTML → html-minifier-next
2. CSS → lightningcss-cli
3. JS → terser (with source maps)
4. Source maps uploaded to Sentry
5. Minified output force-pushed to `live-min` branch
6. GitHub Pages serves from `live-min`; Cloudflare cache is then purged

The `main` branch is for development; `live` is the pre-minification source; `live-min` is what's actually served at guiruggiero.com.

## Sentry

Errors logged to the `website` project (`WEBSITE-*` issue IDs).
