# 🚀 Gui's digital Swiss Army knife

Welcome to the codebase powering my corner of the internet! This isn't your average personal website - it's a playground of utilities and AI-powered goodness that makes both my life and yours more interesting.

Star of the show? Meet GuiPT, my AI alter-ego. Think ChatGPT, but with a PhD in All Things Gui™ and a better name. I'm probably biased there. Ask it anything about me, my work, or if I like tomatoes (spoiler: I don't).

The rest of the site is my professional highlight reel and a collection of utilities I built because it's fun and, well... why not make life easier?

## ✨ Features

### AI assistant
- Real-time interaction with custom AI assistant GuiPT
- Context carryover in long conversations
- Detailed and environment-based chat logging
- Rate limiting to prevent abuse

### User experience
- Responsive design
- Interactive UI with smooth animations
- Cookie consent using local storage
- Custom 404 page and favicons
- Fast loading time with preloading, preconnecting, and image optimization
- Graceful failures handling API call timeouts

### Performance & safety
- Automated minification of code and cache purging at build time
- Safe input sanitization and restrictions
- Automatic API call retries

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

### Analytics
- Firebase Firestore - chat logging
- Google Analytics - traffic tracking
- Google Tag Manager - analytics management

### External services
- Cal.com - meeting scheduling
- Miro - whiteboard
- Google Drive - file storage

## 📦 Dependencies

### UI Components & Interactions
- `iconify-icon` - icons library
- `typed.js` - animated typing effect

### API & data management
- `axios` - API communication
- `firebase` and `firebase-firestore-lite` - Firebase Firestore integration

### Build & optimization
- `html-minifier` - HTML minification
- `lightningcss-cli` - CSS minification
- `terser` - JavaScript minification
- `cwebp-bin` - WebP image conversion

### Development
- `http-server` - local development server
- `ngrok` - local development tunneling
- `eslint` - code linting

---

#### 📄 License
This project is licensed under the [MIT License](LICENSE). Attribution is required.

#### ⚠️ Disclaimer
This software is provided "as is" without any warranties. Use at your own risk. The author is not responsible for any consequences of using this software.
