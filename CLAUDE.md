# Website Codebase Reference

## Architecture

This is a **static vanilla JavaScript website** — no framework, no bundler, no transpilation. All JS is written as ES6 modules and loaded directly from HTML via `<script type="module">`. The backend API is a Firebase Cloud Function in `guipt/`.

### Pages and Modules

- `index.html` — Main page; loads the GuiPT AI chat interface
- `resume.html` — Portfolio/resume page
- Various external utility pages (`resume-pdf.html`, `scheduling.html`, etc.) using embedded content and with `noindex` meta tag
- Internal/personal utility pages (`onairsign.html`) with `noindex` meta tag and no GTM or Google Analytics
- Various redirect pages (`linkedin.html`, `github.html`, etc.) using `modules/redirect.js`
- `modules/` — ES6 modules:
  - `main.js` — Orchestrates chat: event listeners, turn flow, history management
  - `ui.js` — DOM manipulation, chat window expand/collapse, loader
  - `guipt.js` — API call to the GuiPT Cloud Function with axios + retry
  - `firebase.js` — Firestore Lite logging (`createLog`, `logTurn`)
  - `validation.js` — Input sanitization, length check, rate limiting (5 msg/min)
  - `localization.js` — i18n, auto-detects browser locale; exposes an async `getLangData()` (not a top-level-await default export — that pattern caused an intermittent WebKit TDZ error, see WEBSITE-23) that callers `await`
  - `theme-toggle.js` — Dark/light mode, persisted in localStorage
  - `sentry.js` — Error tracking initialization
  - `cookie-banner.js` — Google Analytics consent
  - `redirect.js` — URL redirection helper

### Dev vs. Production Loading

Scripts auto-detect the environment at runtime. On `localhost` or ngrok, `.js` modules are loaded; on production, `.min.js` is used. This means the file a page loads is determined by the script tag in the HTML — no webpack aliases or env flags.

### Localization

All UI strings live in `locales/en.js` and `locales/pt.js`. When adding new UI text, add keys to both locale files. The language is auto-detected from `navigator.language`.

### Linting

ESLint is configured to lint JS, HTML, CSS, YAML, and Markdown. The CI pipeline does not run lint automatically — it only minifies and deploys.

## Deployment Pipeline

Pushing to the `live` branch triggers the minification workflow:
1. HTML → html-minifier-next
2. CSS → lightningcss-cli
3. JS → terser (with source maps)
4. Source maps uploaded to Sentry (before the delete step, since sourcemaps need the plain `.js` files and their content to still be present)
5. Delete files not needed at runtime: `.github/`, `guipt/`, `sonic/agentcore/`, `sonic/scripts/`, the plain (non-`.min.js`) `modules/*.js` sources, and dev-only root files (`CLAUDE.md`, `package.json`, etc.) — any new backend-only or dev-only directory should be added to this list so its source doesn't leak into the public `live-min` branch
6. Minified output force-pushed to `live-min` branch
7. GitHub Pages serves from `live-min`; Cloudflare cache is then purged

The `main` branch is for development; `live` is the pre-minification source; `live-min` is what's actually served at guiruggiero.com.

### Syncing `main` into `live`

`main` and `live` have diverged commit histories (past syncs went through squash-merged PRs), so `git push origin main:live` is rejected as non-fast-forward even when the two branches' file contents already match. Don't force-push to reconcile them. Instead, open a PR with base `live` and head `main`, then merge it with a regular merge commit (`gh pr merge <number> --merge`) — not squash or rebase, to preserve history. Before merging, `git diff --stat origin/live origin/main` is worth a look to confirm nothing surprising is riding along.

Name the sync PR for its actual content, not the mechanical action — e.g. `Weekly update`, `Bump dependencies`, or (for a large mixed batch) `Too many changes/updates accumulated to list`, not a generic title like "Sync main into live".

The SonarCloud check on these PRs can fail on pre-existing findings unrelated to the sync itself (e.g. Dockerfile or Python findings in `sonic/agentcore/`) — it isn't a required check, so a failure there doesn't block merging; confirm via `sonarqube-code-scanning` that the findings predate the sync before merging anyway.

`guipt/` is deployed independently and separately from this pipeline (`npm run deploy` from within `guipt/`, using whatever is on local disk — not tied to git state). Never let `guipt/index.js` reference files that aren't committed to git (e.g. an in-progress `tools/`/`utils/` addition) — it'll deploy fine from local disk, but leaves `main` broken for a fresh clone and creates drift between what's committed and what's actually running in production.

## Sentry

Errors logged to the `website` project (`WEBSITE-*` issue IDs).

## SonarQube Cloud

Project key `guiruggiero_website`.
