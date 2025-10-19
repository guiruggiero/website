[![CodeQL](https://github.com/guiruggiero/website/actions/workflows/github-code-scanning/codeql/badge.svg)](https://github.com/guiruggiero/website/actions/workflows/github-code-scanning/codeql)
[![Bugs](https://sonarcloud.io/api/project_badges/measure?project=guiruggiero_website&metric=bugs)](https://sonarcloud.io/summary/new_code?id=guiruggiero_website)
[![Quality Gate Status](https://sonarcloud.io/api/project_badges/measure?project=guiruggiero_website&metric=alert_status)](https://sonarcloud.io/summary/new_code?id=guiruggiero_website)
[![Dependabot](https://github.com/guiruggiero/website/actions/workflows/dependabot/dependabot-updates/badge.svg)](https://github.com/guiruggiero/website/actions/workflows/dependabot/dependabot-updates)
[![Code minification](https://github.com/guiruggiero/website/actions/workflows/minification.yml/badge.svg?branch=live)](https://github.com/guiruggiero/website/actions/workflows/minification.yml)
[![Deployment](https://github.com/guiruggiero/website/actions/workflows/pages/pages-build-deployment/badge.svg?branch=live-min)](https://github.com/guiruggiero/website/actions/workflows/pages/pages-build-deployment)

# 🚀 Gui's digital Swiss Army knife

Welcome to the codebase powering my corner of the internet! This isn't your average personal website - it's a playground of utilities and AI-powered goodness that makes both my day and yours more interesting.

Star of the show? Meet GuiPT, my AI alter-ego. Think ChatGPT, but with a PhD in All Things Gui™ and a better name. I'm probably biased there. Ask it anything about me, my work, or if I like tomatoes (spoiler: I don't).

The rest of the site is my professional highlight reel and a collection of utilities I built because it's fun and, well... why not make life easier?

## ✨ Features

### AI assistant
- Real-time interaction with custom AI assistant GuiPT
- Context carryover with chat history
- Prompt suggestions with conversation starters

### User experience
- Responsive design
- Light and dark theme choices with preference memory
- Localization with English and Portuguese languages
- Interactive UI with smooth animations
- Cookie consent with acceptance memory
- Custom 404 page
- Transparent favicons for light and dark browser modes
- Very fast loading time
- Graceful failures handling API call timeouts

### Performance & safety
- Automated minification of code and cache purging at build time
- Preloading, preconnecting, and image optimization
- Automatic API call retries
- Detailed and environment-based chat logging
- Safe input sanitization and restrictions
- Rate limiting
- Code vulnerability and quality scanning

### Utilities
- Branded redirects to key online profiles or services
- Embedded collaboration utilities
- Automatic dependency update tracking

### Optimization
- Meta tags and JSON-LD for search engine and social media
- Simple sitemap.xml and robots.txt
- Maintainable and reusable modular files and components

## 🛠️ Technologies

### Core stack
- HTML5, CSS3, JavaScript (vanilla)
- [GuiPT API](https://github.com/guiruggiero/guipt)

### Infrastructure
- GitHub Pages - hosting
- Cloudflare - CDN, redirects, and cache management
- jsDelivr - dependencies CDN

### Development
- GitHub Actions - automated deployments
- GitHub Dependabot - dependency management
- Snyk - vulnerability scanning
- SonarQube - code quality and security

### Analytics
- Firebase Firestore - chat logging
- Google Analytics - traffic tracking
- Google Tag Manager - analytics management
- Sentry - error tracking and monitoring

### External services
- Cal.com - meeting scheduling
- Miro - whiteboard
- Google Drive - file storage
- Matador Network - travel map

## 📦 Dependencies

### UI Components & Interactions
- `iconify-icon` - icons library
- `typed.js` - animated typing effect

### API & data management
- `axios` and `axios-retry` - API communication with retry logic
- `firebase` and `firebase-firestore-lite` - Firebase Firestore integration

### Build & optimization
- `cwebp-bin` - WebP image conversion
- `html-minifier` - HTML minification
- `lightningcss-cli` - CSS minification
- `terser` - JavaScript minification

### Development
- `@sentry/browser` and `getsentry/action-release` - Sentry integration
- `eslint`, `eslint-stylistic`, `html-eslint`, and `eslint-plugin-yml` - code linting
- `http-server` - local development server
- `localtunnel` - local development tunneling

---

#### 📄 License
This project is licensed under the [MIT License](LICENSE). Attribution is required.

#### ⚠️ Disclaimer
This software is provided "as is" without any warranties. Use at your own risk. The author is not responsible for any consequences of using this software.
