globalThis.sentryOnLoad = function() {
    // Initialization
    Sentry.init({
        environment: globalThis.location?.href.includes("ngrok") ? "dev" : "v1",
        beforeSend(event) {
            const frames = event.exception?.values?.[0]?.stacktrace?.frames;
            if (frames?.some(f =>
                f.filename?.includes("chrome-extension://") ||
                f.filename?.includes("moz-extension://") ||
                f.filename?.includes("safari-web-extension://"),
            )) return null;

            return event;
        },
    });

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