// Serves the PdfCraft web build from the R2 bucket, with the header rules from its _headers file

// Content types by extension - R2 objects are uploaded with the same ones
const contentTypes = {
    html: "text/html; charset=utf-8",
    js: "text/javascript",
    wasm: "application/wasm",
    onnx: "application/octet-stream",
    txt: "text/plain; charset=utf-8",
    md: "text/markdown; charset=utf-8",
};

// Page title and favicons, injected into the app page - the release's own index.html has no favicon
// Same GR favicons as the website, one pair per color scheme
const pageTitle = "PdfCraft - Gui Ruggiero";
const titleSuffix = " - Gui Ruggiero";

// The app rewrites document.title at runtime (to the open document's name), so keep the suffix on every change
const titleWatcher = `<script>
(() => {
    const suffix = ${JSON.stringify(titleSuffix)};
    const title = document.querySelector("title");
    const apply = () => {
        if (!document.title.endsWith(suffix)) document.title += suffix;
    };
    new MutationObserver(apply).observe(title, {childList: true, characterData: true, subtree: true});
    apply();
})();
</script>`;
const favicons = `
<link rel="icon" type="image/x-icon" href="https://guiruggiero.com/images/favicons/favicon-light.ico" media="(prefers-color-scheme: dark)">
<link rel="icon" type="image/png" sizes="32x32" href="https://guiruggiero.com/images/favicons/favicon-32x32-light.png" media="(prefers-color-scheme: dark)">
<link rel="icon" type="image/x-icon" href="https://guiruggiero.com/images/favicons/favicon-dark.ico" media="(prefers-color-scheme: light)">
<link rel="icon" type="image/png" sizes="32x32" href="https://guiruggiero.com/images/favicons/favicon-32x32-dark.png" media="(prefers-color-scheme: light)">`;

export default {
    async fetch(request, env) {
        // Static files only
        if (request.method !== "GET" && request.method !== "HEAD") {
            return new Response("Method not allowed", {status: 405, headers: {Allow: "GET, HEAD"}});
        }

        try {
            // Map the path to a bucket key, "/" being the app page
            const path = decodeURIComponent(new URL(request.url).pathname);
            const key = path === "/" ? "index.html" : path.slice(1);

            // R2 range, conditional and HEAD handling, so large files resume and revalidate
            const object = await env.BUCKET.get(key, {
                range: request.headers,
                onlyIf: request.headers,
            });
            if (!object) return new Response("Not found", {status: 404});

            const headers = new Headers();
            object.writeHttpMetadata(headers);
            headers.set("etag", object.httpEtag);
            headers.set("X-Content-Type-Options", "nosniff");

            // Hashed assets never change, the page itself always revalidates
            const extension = key.split(".").pop();
            if (!headers.has("content-type")) headers.set("content-type", contentTypes[extension] || "application/octet-stream");
            headers.set("Cache-Control", key === "index.html" ? "no-cache" : (extension === "wasm" || extension === "js") ? "public, max-age=31536000, immutable" : "public, max-age=86400");
            headers.set("Accept-Ranges", "bytes");

            // Conditional request matched, no body
            if (!("body" in object)) return new Response(null, {status: 304, headers});

            // Partial content for range requests
            if (object.range && request.headers.has("range")) {
                const {offset = 0, length = object.size - offset} = object.range;
                headers.set("Content-Range", `bytes ${offset}-${offset + length - 1}/${object.size}`);
                return new Response(request.method === "HEAD" ? null : object.body, {status: 206, headers});
            }

            // App page: set the title and add favicons on the way out
            if (key === "index.html" && request.method === "GET") {
                return new HTMLRewriter()
                    .on("title", {element(element) {
                        element.setInnerContent(pageTitle);
                    }})
                    .on("head", {element(element) {
                        element.append(favicons + titleWatcher, {html: true});
                    }})
                    .transform(new Response(object.body, {headers}));
            }

            return new Response(request.method === "HEAD" ? null : object.body, {headers});

        } catch (error) {
            console.error("PdfCraft host error", {url: request.url, message: error.message, stack: error.stack});
            return new Response("Internal error", {status: 500});
        }
    },
};