// Updates an app's R2 bucket from the latest GitHub release of its web build
// Run with `npm run update-app -- [<app>...] [--force] [--version <tag>] [--min-age-days <n>]` from this folder - needs gh, python3, CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID

// Imports
import {promisify} from "node:util";
import {execFile} from "node:child_process";
import {readdir, readFile, mkdtemp, writeFile, rm, stat} from "node:fs/promises";
import path from "node:path";
import {tmpdir} from "node:os";

const execFileAsync = promisify(execFile);

// Per-app settings - add new apps here
const apps = {
    pdfcraft: {
        repo: "storytold/pdfcraft",
        bucket: "pdfcraft",
        assetPattern: "pdfcraft-web-*.zip",
    },
    photocraft: {
        repo: "storytold/photocraft",
        bucket: "photocraft",
        assetPattern: "photocraft-web-*.zip",
        // Upstream bug (storytold/photocraft#10017): the loader imports ./snippets/, shipped only at the root
        copies: {"snippets/": "app/snippets/"},
    },
    soundcraft: {
        repo: "storytold/soundcraft",
        bucket: "soundcraft",
        assetPattern: "soundcraft-web-*.zip",
    },
    filmcraft: {
        repo: "storytold/filmcraft",
        bucket: "filmcraft",
        assetPattern: "filmcraft-web-*.zip",
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
    png: "image/png",
};

const manifestKey = "manifest.json";

// Gzipped pieces of an app's WASM, served as they are
const partFile = /\.part-[a-z]+$/;

const context = {};

class StepError extends Error {
    constructor(step, cause, hint) {
        super(`${step}: ${cause.message}`, {cause});
        this.step = step;
        this.hint = hint;
    }
}

async function step(name, hint, action) {
    context.step = name;
    try {
        return await action();

    } catch (error) {
        throw error instanceof StepError ? error : new StepError(name, error, hint);
    }
}

async function run(command, args, options = {}) {
    const {stdout} = await execFileAsync(command, args, {maxBuffer: 64 * 1024 * 1024, ...options});
    return stdout;
}

function wrangler(appDir, args) {
    return run("npx", ["wrangler", ...args, "--remote"], {cwd: appDir});
}

function option(name) {
    const index = process.argv.indexOf(`--${name}`);
    return index === -1 ? undefined : process.argv[index + 1];
}

// An explicit version wins, then the newest release old enough, else the latest
async function chooseVersion(app, pinned, minAgeDays) {
    if (pinned) return /^\d/.test(pinned) ? `v${pinned}` : pinned;
    if (!minAgeDays) return JSON.parse(await run("gh", ["release", "view", "--repo", app.repo, "--json", "tagName"])).tagName;

    const releases = JSON.parse(await run("gh", ["release", "list", "--repo", app.repo, "--exclude-drafts", "--exclude-pre-releases", "--limit", "30", "--json", "tagName,publishedAt"]));
    const cutoff = Date.now() - minAgeDays * 24 * 60 * 60 * 1000;
    const index = releases.findIndex((release) => Date.parse(release.publishedAt) <= cutoff);
    if (index === -1) throw new Error(`No release is ${minAgeDays} days old yet`);
    context.skippedNewer = releases.slice(0, index).map((release) => release.tagName);
    return releases[index].tagName;
}

async function listFiles(folder) {
    const entries = await readdir(folder, {recursive: true, withFileTypes: true});
    return entries
        .filter((entry) => entry.isFile())
        .map((entry) => path.relative(folder, path.join(entry.parentPath, entry.name)).split(path.sep).join("/"));
}

async function readManifest(appDir, bucket, workDir) {
    const target = path.join(workDir, "previous-manifest.json");
    await wrangler(appDir, ["r2", "object", "get", `${bucket}/${manifestKey}`, "--file", target]);
    return JSON.parse(await readFile(target, "utf8"));
}

// Files without an extension are licences and notices
function contentTypeFor(key) {
    const extension = key.includes(".") ? key.split(".").pop() : "";
    return contentTypes[extension] || (extension ? "application/octet-stream" : "text/plain; charset=utf-8");
}

async function putObject(appDir, bucket, key, file) {
    await wrangler(appDir, ["r2", "object", "put", `${bucket}/${key}`, "--file", file, "--content-type", contentTypeFor(key)]);
}

async function downloadRelease(app, version, workDir) {
    const downloadDir = path.join(workDir, "download");
    const extractDir = path.join(workDir, "extract");

    try {
        await run("gh", ["release", "download", version, "--repo", app.repo, "--pattern", app.assetPattern, "--dir", downloadDir]);

    } catch (error) {
        const release = JSON.parse(await run("gh", ["release", "view", version, "--repo", app.repo, "--json", "assets"]));
        context.releaseAssets = release.assets.map((asset) => `${asset.name} (${asset.size} bytes)`);
        throw error;
    }

    const [zipName] = await readdir(downloadDir);
    await run("python3", ["-I", "-c", "import zipfile, sys; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])", path.join(downloadDir, zipName), extractDir]);

    const topLevel = await readdir(extractDir);
    return topLevel.length === 1 ? path.join(extractDir, topLevel[0]) : extractDir;
}

async function listBucket(app) {
    const {CLOUDFLARE_API_TOKEN: token, CLOUDFLARE_ACCOUNT_ID: accountId} = process.env;
    if (!token || !accountId) throw new Error("CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID must be set");

    const found = new Map();
    let cursor = "";
    do {
        const query = new URLSearchParams({per_page: "500", ...(cursor && {cursor})});
        const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/buckets/${app.bucket}/objects?${query}`, {headers: {Authorization: `Bearer ${token}`}});
        const body = await response.json();
        if (!response.ok || !body.success) throw new Error(`Cloudflare API answered ${response.status}: ${JSON.stringify(body.errors)}`);
        for (const object of body.result) found.set(object.key, object);
        cursor = body.result_info?.is_truncated ? body.result_info.cursor : "";
    } while (cursor);

    return found;
}

async function removeExtras(appName, appDir, app, found, keep) {
    const extras = [...found.keys()].filter((key) => key !== manifestKey && !keep.has(key));
    for (const key of extras) {
        await wrangler(appDir, ["r2", "object", "delete", `${app.bucket}/${key}`]);
        console.log(`${appName}: deleted ${key}`);
    }
}

// Sizes are only compared when the release files are local
async function verifyBucket(appName, app, expected) {
    const found = await listBucket(app);
    const problems = [];
    for (const [key, {size}] of expected) {
        const object = found.get(key);
        if (!object) problems.push(`missing ${key}`);
        else if (size !== undefined && object.size !== size) problems.push(`${key} is ${object.size} bytes, expected ${size}`);
        else if (object.http_metadata?.contentType !== contentTypeFor(key)) problems.push(`${key} has content type ${object.http_metadata?.contentType}, expected ${contentTypeFor(key)}`);
    }
    for (const key of found.keys()) {
        if (key !== manifestKey && !expected.has(key)) problems.push(`unexpected ${key}`);
    }

    if (problems.length) throw new Error(`${problems.length} problem(s): ${problems.join("; ")}`);
    console.log(`${appName}: bucket check passed for ${expected.size} files`);
}

async function updateApp(appName) {
    const force = process.argv.includes("--force");
    const app = apps[appName];
    if (!app) throw new Error(`Unknown app "${appName}", expected one of: ${Object.keys(apps).join(", ")}`);
    Object.assign(context, {app: appName, repo: app.repo, bucket: app.bucket, assetPattern: app.assetPattern, force, pinned: option("version"), minAgeDays: option("min-age-days"), run: process.env.GITHUB_RUN_ID || "local"});

    const appDir = import.meta.dirname;
    const workDir = await mkdtemp(path.join(tmpdir(), `${appName}-update-`));

    try {
        const version = await step("choose the release", "gh couldn't read the repo's releases: check the repo name, GH_TOKEN and rate limits. If no release is old enough yet, the next run picks one up", () => chooseVersion(app, option("version"), Number(option("min-age-days"))));
        context.target = version;

        const found = await step("list the bucket", "Check that the R2 token can list the bucket, that CLOUDFLARE_ACCOUNT_ID is right and that the bucket name matches", () => listBucket(app));
        context.bucketFiles = found.size;
        const previous = found.has(manifestKey)
            ? await step("read the manifest", "The manifest exists but couldn't be read: re-run, and if it persists check it in the bucket", () => readManifest(appDir, app.bucket, workDir))
            : null;
        context.bucketVersion = previous?.version || "nothing";
        console.log(`${appName}: target ${version}, bucket has ${context.bucketVersion}`);

        if (previous?.version === version && !force) {
            console.log(`${appName}: up to date`);
            await step("remove leftover files", "Delete the extra files from the bucket by hand, or re-run", () => removeExtras(appName, appDir, app, found, new Set(previous.files)));
            await step("verify the bucket", "The bucket doesn't match the manifest: re-run with force to upload the release again", () => verifyBucket(appName, app, new Map(previous.files.map((key) => [key, {}]))));
            return;
        }

        const siteDir = await step("download the release", "Compare assetPattern with releaseAssets below: the web build may have been renamed", () => downloadRelease(app, version, workDir));
        const releaseFiles = (await listFiles(siteDir)).filter((key) => !skippedFiles.has(key));

        // Bucket key -> file in the release, plus the app's copies
        const sources = new Map(releaseFiles.map((key) => [key, key]));
        for (const [from, to] of Object.entries(app.copies || {})) {
            for (const key of releaseFiles.filter((file) => file.startsWith(from))) {
                const target = to + key.slice(from.length);
                if (!sources.has(target)) sources.set(target, key);
            }

            // No source and no existing destination: upstream changed the layout
            if (![...sources.keys()].some((key) => key.startsWith(to))) {
                throw new StepError("check the release", new Error(`Nothing to copy from ${from} to ${to}, and ${to} isn't in the release either`), "Upstream changed the zip layout: open the app, find where the missing files moved, and update or drop this app's copies setting");
            }
        }
        const files = [...sources.keys()];
        context.releaseFiles = files.length;
        if (!files.includes("index.html")) throw new StepError("check the release", new Error("No index.html in the release, refusing to upload"), "The release layout changed: look at the zip's contents");

        // Stop before touching the bucket on a file type without a content type
        const unknown = files.filter((key) => key.includes(".") && !contentTypes[key.split(".").pop()] && !partFile.test(key));
        if (unknown.length) throw new StepError("check the release", new Error(`Files without a content type: ${unknown.join(", ")}`), "Add the extension to contentTypes in apps/update.js and to the Worker's fallback map in apps/shared/worker.js, deploy the Worker, then re-run");

        // Hashed assets first and the page last, so visitors never get a page pointing at missing files
        const ordered = [...files.filter((key) => key !== "index.html"), "index.html"];
        await step("upload the release", "The bucket still serves the previous version, because index.html goes last: re-run", async () => {
            for (const key of ordered) {
                context.uploading = key;
                await putObject(appDir, app.bucket, key, path.join(siteDir, sources.get(key)));
                console.log(`${appName}: uploaded ${key}`);
            }
        });

        await step("write the manifest", "The release is uploaded but the manifest still names the previous version: re-run", async () => {
            const manifestFile = path.join(workDir, manifestKey);
            await writeFile(manifestFile, JSON.stringify({version, files: ordered}, null, 4));
            await putObject(appDir, app.bucket, manifestKey, manifestFile);
        });

        await step("remove old files", "The app already runs the new version: re-run, which removes the leftovers", async () => removeExtras(appName, appDir, app, await listBucket(app), new Set(ordered)));

        console.log(`${appName}: updated to ${version}`);
        await step("verify the bucket", "Re-run with force to upload the release again", async () => {
            const expected = new Map();
            for (const key of ordered) expected.set(key, {size: (await stat(path.join(siteDir, sources.get(key)))).size});
            await verifyBucket(appName, app, expected);
        });

    } finally {
        await rm(workDir, {recursive: true, force: true});
    }
}

function report(error) {
    const cause = error.cause || error;
    console.error(`::error title=${context.app || "app"} update failed::${error.message.split("\n")[0]}`);
    console.error([
        `Update failed at step: ${error.step || context.step || "start"}`,
        `Error: ${cause.message}`,
        cause.cmd && `Command: ${cause.cmd}`,
        cause.code !== undefined && `Exit code: ${cause.code}`,
        cause.stderr && `stderr: ${String(cause.stderr).trim()}`,
        `Context: ${JSON.stringify(context, null, 4)}`,
        error.hint && `What to try: ${error.hint}`,
    ].filter(Boolean).join("\n"));
}

// App names are the arguments that aren't flags or flag values
const names = process.argv.slice(2).filter((argument, index, all) => !argument.startsWith("--") && !(all[index - 1] || "").match(/^--(version|min-age-days)$/));

if (option("version") && names.length !== 1) {
    console.error("--version needs exactly one app name");
    process.exitCode = 1;

} else {
    // One failing app doesn't stop the others
    for (const appName of names.length ? names : Object.keys(apps)) {
        for (const key of Object.keys(context)) delete context[key];

        try {
            await updateApp(appName);

        } catch (error) {
            report(error);
            process.exitCode = 1;
        }
    }
}