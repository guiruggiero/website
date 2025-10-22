globalThis.sentryOnLoad = function() {
    // Initialization
    Sentry.init({environment: globalThis.location?.href.includes("ngrok") ? "dev" : "v1"});

    // Set session context
    Sentry.setTag("page", globalThis.location?.pathname);
    globalThis.innerWidth && Sentry.setTag("screenWidth", globalThis.innerWidth);
    globalThis.innerHeight && Sentry.setTag("screenHeight", globalThis.innerHeight);
    navigator.userAgent && Sentry.setTag("userAgent", navigator.userAgent);

    // Global error handler
    globalThis.addEventListener("error", (event) => {
        Sentry.captureException(event.error, {
            contexts: {
                globalError: {
                    file: event.filename,
                    line: event.lineno,
                    column: event.colno,
                    errorMessage: event.error?.message,
                },
            },
        });
    });

    // Unhandled promise rejection handler
    globalThis.addEventListener("unhandledrejection", (event) => {
        Sentry.captureException(event.reason, {
            contexts: {
                unhandledPromise: {
                    status: "Unhandled promise rejection",
                    name: event.reason?.name || event.reason?.constructor?.name,
                    reasonDetails: String(event.reason),
                },
            },
        });
    });
};