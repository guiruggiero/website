// Updates an app's R2 bucket from the latest GitHub release of its web build
// Run with `npm run update-app [-- --force]` from the app's folder - needs gh, python3 and Cloudflare credentials

// Imports
import {promisify} from "node:util";
import {execFile} from "node:child_process";
import {readdir, readFile, mkdtemp, writeFile, rm} from "node:fs/promises";
import path from "node:path";
import {tmpdir} from "node:os";

const execFileAsync = promisify(execFile);

// Per-app settings - add new apps here
const apps = {
    pdfcraft: {
        repo: "storytold/pdfcraft",
        bucket: "pdfcraft",
        url: "https://pdfcraft.guiruggiero.com",
        assetPattern: "pdfcraft-web-*.zip",
    },
};

// Host config files from the zip - the Worker applies those rules itself
const skippedFiles = new Set(["_headers", ".htaccess"]);

// Same content types the Worker falls back to
const contentTypes = {
    html: "text/html; charset=utf-8",
    js: "text/javascript",
    wasm: "application/wasm",
    onnx: "application/octet-stream",
    txt: "text/plain; charset=utf-8",
    md: "text/markdown; charset=utf-8",
    json: "application/json",
};

// Lists what each version holds, so the next run can remove what the new one drops
const manifestKey = "manifest.json";

async function run(command, args, options = {}) {
    const {stdout} = await execFileAsync(command, args, {maxBuffer: 64 * 1024 * 1024, ...options});
    return stdout;
}

// Runs against the real bucket, from the app's folder
function wrangler(appDir, args) {
    return run("npx", ["wrangler", ...args, "--remote"], {cwd: appDir});
}

async function listFiles(folder) {
    const entries = await readdir(folder, {recursive: true, withFileTypes: true});
    return entries
        .filter((entry) => entry.isFile())
        .map((entry) => path.relative(folder, path.join(entry.parentPath, entry.name)).split(path.sep).join("/"));
}

async function readManifest(appDir, bucket, workDir) {
    const target = path.join(workDir, "previous-manifest.json");

    try {
        await wrangler(appDir, ["r2", "object", "get", `${bucket}/${manifestKey}`, "--file", target]);
        return JSON.parse(await readFile(target, "utf8"));

    } catch {
        // No manifest yet, or the object doesn't exist
        return null;
    }
}

// Files without an extension are licences and notices
async function putObject(appDir, bucket, key, file) {
    const extension = key.includes(".") ? key.split(".").pop() : "";
    const contentType = contentTypes[extension] || (extension ? "application/octet-stream" : "text/plain; charset=utf-8");
    await wrangler(appDir, ["r2", "object", "put", `${bucket}/${key}`, "--file", file, "--content-type", contentType]);
}

async function downloadRelease(app, version, workDir) {
    const downloadDir = path.join(workDir, "download");
    const extractDir = path.join(workDir, "extract");
    await run("gh", ["release", "download", version, "--repo", app.repo, "--pattern", app.assetPattern, "--dir", downloadDir]);

    const [zipName] = await readdir(downloadDir);
    await run("python3", ["-I", "-c", "import zipfile, sys; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])", path.join(downloadDir, zipName), extractDir]);

    // The build sits in one folder inside the zip
    const topLevel = await readdir(extractDir);
    return topLevel.length === 1 ? path.join(extractDir, topLevel[0]) : extractDir;
}

// Checks the live app through Zero Trust with a service token
async function verifyLive(appName, app, files) {
    const clientId = process.env.CF_ACCESS_CLIENT_ID;
    const clientSecret = process.env.CF_ACCESS_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
        console.log(`${appName}: skipped live check, no CF_ACCESS_CLIENT_ID/CF_ACCESS_CLIENT_SECRET`);
        return;
    }

    const headers = {"CF-Access-Client-Id": clientId, "CF-Access-Client-Secret": clientSecret};
    const request = async (key, method) => {
        // A rejected token redirects to the login, which counts as a failure
        const response = await fetch(`${app.url}/${key.split("/").map(encodeURIComponent).join("/")}`, {method, headers, redirect: "manual"});
        if (response.status !== 200) throw new Error(`${method} ${key} returned ${response.status}`);
        return response;
    };

    // The page, with the title the Worker sets
    const page = await (await request("", "GET")).text();
    if (!page.includes(`<title>${appName.replace(/^./, (letter) => letter.toUpperCase())} - Gui Ruggiero</title>`)) {
        throw new Error("The live page doesn't have the expected title");
    }

    // Every file in the release
    for (const key of files) await request(key, "HEAD");
    console.log(`${appName}: live check passed for ${files.length + 1} requests`);
}

async function main() {
    const appName = process.argv[2];
    const force = process.argv.includes("--force");
    const app = apps[appName];
    if (!app) throw new Error(`Unknown app "${appName}", expected one of: ${Object.keys(apps).join(", ")}`);

    const appDir = path.resolve(import.meta.dirname, appName);
    const workDir = await mkdtemp(path.join(tmpdir(), `${appName}-update-`));

    try {
        // Latest release and what the bucket already has
        const release = JSON.parse(await run("gh", ["release", "view", "--repo", app.repo, "--json", "tagName"]));
        const version = release.tagName;
        const previous = await readManifest(appDir, app.bucket, workDir);
        console.log(`${appName}: latest ${version}, bucket has ${previous?.version || "nothing"}`);

        if (previous?.version === version && !force) {
            console.log(`${appName}: up to date`);
            await verifyLive(appName, app, previous.files);
            return;
        }

        const siteDir = await downloadRelease(app, version, workDir);
        const files = (await listFiles(siteDir)).filter((key) => !skippedFiles.has(key));
        if (!files.includes("index.html")) throw new Error("No index.html in the release, refusing to upload");

        // Hashed assets first and the page last, so visitors never get a page pointing at missing files
        const ordered = [...files.filter((key) => key !== "index.html"), "index.html"];
        for (const key of ordered) {
            await putObject(appDir, app.bucket, key, path.join(siteDir, key));
            console.log(`${appName}: uploaded ${key}`);
        }

        const manifestFile = path.join(workDir, manifestKey);
        await writeFile(manifestFile, JSON.stringify({version, files: ordered}, null, 4));
        await putObject(appDir, app.bucket, manifestKey, manifestFile);

        // Only after everything uploaded, remove the previous version's files that this one doesn't have
        const stale = (previous?.files || []).filter((key) => !ordered.includes(key));
        for (const key of stale) {
            await wrangler(appDir, ["r2", "object", "delete", `${app.bucket}/${key}`]);
            console.log(`${appName}: deleted ${key}`);
        }

        console.log(`${appName}: updated to ${version}`);
        await verifyLive(appName, app, ordered);

    } finally {
        await rm(workDir, {recursive: true, force: true});
    }
}

try {
    await main();

} catch (error) {
    console.error("Update failed:", error.message, error.stderr || "");
    process.exitCode = 1;
}