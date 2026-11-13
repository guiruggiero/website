// Import module dynamically
async function importModule(path) {
    if (globalThis.location?.href.includes("ngrok")) return await import(path.replace(".min.js", ".js"));
    else return await import(path);
}
const {initAdminAuth} = await importModule("./admin-auth.min.js");

// Nothing to load, the page is static links - the gate only reveals them after sign-in
await initAdminAuth();