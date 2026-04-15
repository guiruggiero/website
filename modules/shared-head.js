// Inject shared <head> elements
(function() {
    // Helper: create and append a <link> to <head>; onload fires after rel swap for lazy CSS
    function addLink(attrs, onload) {
        const link = document.createElement("link");
        for (const [k, v] of Object.entries(attrs)) link.setAttribute(k, v);
        if (onload) link.onload = onload;
        document.head.appendChild(link);
    }

    // Cookie banner CSS (lazy-loaded)
    addLink({rel: "preload", href: "styles/cookie-banner.css", as: "style"}, function() {this.onload = null; this.rel = "stylesheet";});

    // Favicons for dark mode
    addLink({rel: "icon", type: "image/x-icon", href: "images/favicons/favicon-light.ico", media: "(prefers-color-scheme: dark)"});
    addLink({rel: "icon", type: "image/png", sizes: "16x16", href: "images/favicons/favicon-16x16-light.png", media: "(prefers-color-scheme: dark)"});
    addLink({rel: "icon", type: "image/png", sizes: "32x32", href: "images/favicons/favicon-32x32-light.png", media: "(prefers-color-scheme: dark)"});
    addLink({rel: "icon", type: "image/png", sizes: "192x192", href: "images/favicons/android-chrome-192x192-light.png", media: "(prefers-color-scheme: dark)"});
    addLink({rel: "icon", type: "image/png", sizes: "512x512", href: "images/favicons/android-chrome-512x512-light.png", media: "(prefers-color-scheme: dark)"});
    addLink({rel: "apple-touch-icon", sizes: "180x180", href: "images/favicons/apple-touch-icon-light.png", media: "(prefers-color-scheme: dark)"});

    // Favicons for light mode
    addLink({rel: "icon", type: "image/x-icon", href: "images/favicons/favicon-dark.ico", media: "(prefers-color-scheme: light)"});
    addLink({rel: "icon", type: "image/png", sizes: "16x16", href: "images/favicons/favicon-16x16-dark.png", media: "(prefers-color-scheme: light)"});
    addLink({rel: "icon", type: "image/png", sizes: "32x32", href: "images/favicons/favicon-32x32-dark.png", media: "(prefers-color-scheme: light)"});
    addLink({rel: "icon", type: "image/png", sizes: "192x192", href: "images/favicons/android-chrome-192x192-dark.png", media: "(prefers-color-scheme: light)"});
    addLink({rel: "icon", type: "image/png", sizes: "512x512", href: "images/favicons/android-chrome-512x512-dark.png", media: "(prefers-color-scheme: light)"});
    addLink({rel: "apple-touch-icon", sizes: "180x180", href: "images/favicons/apple-touch-icon-dark.png", media: "(prefers-color-scheme: light)"});

    // Google Tag Manager
    (function(w, d, s, l, i) {w[l]=w[l]||[];w[l].push({"gtm.start": new Date().getTime(), event: "gtm.js"});var f=d.getElementsByTagName(s)[0], j=d.createElement(s), dl=l!="dataLayer"?"&l="+l:"";j.async=true;j.src="https://www.googletagmanager.com/gtm.js?id="+i+dl;f.parentNode.insertBefore(j, f);})(window, document, "script", "dataLayer", "GTM-PX5VBDT7");
})();