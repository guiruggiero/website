window.sentryOnLoad = function() {
    // Initialization
    Sentry.init({environment: window.location && window.location.href.includes("ngrok") ? "dev" : "v1"});

    // Set session context
    window.location && Sentry.setTag("page", window.location.pathname);
    window.innerWidth && Sentry.setTag("screenWidth", window.innerWidth);
    window.innerHeight && Sentry.setTag("screenHeight", window.innerHeight);
    navigator.userAgent && Sentry.setTag("userAgent", navigator.userAgent);

    // Global error handler
    window.addEventListener("error", (event) => {
        Sentry.captureException(event.error, {
            contexts: {
                globalError: {
                    file: event.filename,
                    line: event.lineno,
                    column: event.colno,
                    errorMessage: event.error.message,
                },
            },
        });
    });

    // Unhandled promise rejection handler
    window.addEventListener("unhandledrejection", (event) => {
        Sentry.captureException(event.reason, {
            contexts: {
                unhandledPromise: {
                    status: "Unhandled promise rejection",
                    name: event.reason.name || event.reason.constructor.name,
                    reasonDetails: String(event.reason),
                },
            },
        });
    });
};