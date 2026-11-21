// Serves each app's web build from its R2 bucket, picking the app from the hostname

// Fallback content types by extension
const contentTypes = {
    html: "text/html; charset=utf-8",
    js: "text/javascript",
    wasm: "application/wasm",
    onnx: "application/octet-stream",
    txt: "text/plain; charset=utf-8",
    md: "text/markdown; charset=utf-8",
    json: "application/json",
    png: "image/png",
};

// Title suffix and favicons, injected into the app page
const titleSuffix = " - Gui Ruggiero";

// The app rewrites document.title at runtime, so keep the suffix on every change
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

// Per app: bucket binding and the files that keep their name between releases
const apps = {
    pdfcraft: {name: "PdfCraft", bucket: "BUCKET_PDFCRAFT", revalidate: []},
    photocraft: {name: "PhotoCraft", bucket: "BUCKET_PHOTOCRAFT", revalidate: ["app/photocraft-web.js", "app/parts.txt"]},
    soundcraft: {name: "SoundCraft", bucket: "BUCKET_SOUNDCRAFT", revalidate: []},
    filmcraft: {name: "FilmCraft", bucket: "BUCKET_FILMCRAFT", revalidate: ["audio-worklet.js"]},
};

export default {
    async fetch(request, env) {
        // Static files only
        if (request.method !== "GET" && request.method !== "HEAD") {
            return new Response("Method not allowed", {status: 405, headers: {Allow: "GET, HEAD"}});
        }

        // The app is the first label of the hostname
        const url = new URL(request.url);
        const app = apps[url.hostname.split(".")[0]];
        if (!app) return new Response("Not found", {status: 404});

        try {
            // Map the path to a bucket key, "/" being the app page
            const path = decodeURIComponent(url.pathname);
            const key = path === "/" ? "index.html" : path.slice(1);

            // R2 handles range and conditional requests
            const object = await env[app.bucket].get(key, {
                range: request.headers,
                onlyIf: request.headers,
            });
            if (!object) return new Response("Not found", {status: 404});

            const headers = new Headers();
            object.writeHttpMetadata(headers);
            headers.set("etag", object.httpEtag);
            headers.set("X-Content-Type-Options", "nosniff");

            // Hashed assets are immutable, the page and unhashed files revalidate
            const extension = key.split(".").pop();
            if (!headers.has("content-type")) headers.set("content-type", contentTypes[extension] || "application/octet-stream");
            const isImmutable = extension === "wasm" || extension === "js" || extension.startsWith("part-");
            const longCache = isImmutable ? "public, max-age=31536000, immutable" : "public, max-age=86400";
            headers.set("Cache-Control", key === "index.html" || app.revalidate.includes(key) ? "no-cache" : longCache);
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
                        element.setInnerContent(`${app.name}${titleSuffix}`);
                    }})
                    .on("head", {element(element) {
                        element.append(favicons + titleWatcher, {html: true});
                    }})
                    .transform(new Response(object.body, {headers}));
            }

            return new Response(request.method === "HEAD" ? null : object.body, {headers});

        } catch (error) {
            console.error(`${app.name} host error`, {url: request.url, message: error.message, stack: error.stack});
            return new Response("Internal error", {status: 500});
        }
    },
};