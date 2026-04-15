// Inspect and repair numeric `start` fields in Firestore chat logs
// Usage (from functions/ directory):
//   node scripts/timestamp-fix.js pull           → fetch and display all docs
//   node scripts/timestamp-fix.js fix --dry-run  → preview fixes, no writes
//   node scripts/timestamp-fix.js fix            → apply fixes (y/N prompt)
// Auth: uses Google Application Default Credentials
//   Run `gcloud auth application-default login` once if needed

import {writeFileSync} from "node:fs";
import {createInterface} from "node:readline";
import {fileURLToPath} from "node:url";
import {dirname} from "node:path";
import {initializeApp, deleteApp} from "firebase-admin/app";
import {getFirestore, Timestamp} from "firebase-admin/firestore";

const __dirname = dirname(fileURLToPath(import.meta.url));

const app = initializeApp();
const db = getFirestore();

async function shutdown() {
  await deleteApp(app);
  process.exit(0);
}

process.on("SIGINT", shutdown);
const COLLECTIONS = ["dev", "mvp", "v1"];

// Check if a number looks like a millisecond Unix timestamp
// (post-2000, within 100 years from now)
function isMillisTimestamp(value) {
  return typeof value === "number" &&
    value > 946684800000 &&
    value < Date.now() + 3153600000000;
}

// Format a Firestore field value for terminal display
function formatField(value) {
  if (value === null || value === undefined) return String(value);
  if (typeof value === "object" && typeof value.toDate === "function") {
    return `Timestamp → ${value.toDate().toISOString()}`;
  }
  if (isMillisTimestamp(value)) {
    return `${value}  ← NUMBER (${new Date(value).toISOString()})`;
  }
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

// Recursively serialize Firestore Timestamps for JSON output
function serialize(value) {
  if (!value || typeof value !== "object") return value;
  if (typeof value.toDate === "function") {
    return {
      _type: "Timestamp",
      seconds: value.seconds,
      nanoseconds: value.nanoseconds,
      iso: value.toDate().toISOString(),
    };
  }
  if (Array.isArray(value)) return value.map(serialize);
  return Object.fromEntries(
    Object.entries(value).map(([k, v]) => [k, serialize(v)]),
  );
}

// Prompt user for y/N confirmation
async function confirm(question) {
  const rl = createInterface({input: process.stdin, output: process.stdout});
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === "y");
    });
    rl.on("error", () => {
      rl.close();
      resolve(false);
    });
  });
}

// Pull: fetch and display all documents from all collections
const pull = async () => {
  console.log("Pulling logs from Firestore...\n");
  const allDocs = [];

  for (const col of COLLECTIONS) {
    console.log(`=== ${col} ===`);
    const snapshot = await db.collection(col).get();
    if (snapshot.empty) {
      console.log("  (empty)\n");
      continue;
    }

    for (const docSnap of snapshot.docs) {
      const data = docSnap.data();
      allDocs.push({id: docSnap.id, collection: col, data});

      console.log(`  [${docSnap.id}]`);
      for (const [k, v] of Object.entries(data)) {
        if (k === "turns") {
          const count = Object.keys(v).length;
          console.log(`    turns: (${count} turn${count !== 1 ? "s" : ""})`);
        } else {
          console.log(`    ${k}: ${formatField(v)}`);
        }
      }
      console.log();
    }
  }

  const numericCount = allDocs
    .filter((d) => isMillisTimestamp(d.data.start)).length;
  console.log(`Total documents: ${allDocs.length}`);
  console.log(`  With numeric start:   ${numericCount}`);
  console.log(`  With Timestamp start: ${allDocs.length - numericCount}`);

  const snapshotPath = `${__dirname}/logs-snapshot.json`;
  writeFileSync(
    snapshotPath,
    JSON.stringify(
      allDocs.map((d) => ({
        id: d.id, collection: d.collection, data: serialize(d.data),
      })),
      null, 4,
    ),
  );
  console.log(`\nSnapshot saved to: scripts/logs-snapshot.json`);
};

// Fix: find and repair docs with a numeric start field
const fix = async () => {
  const isDryRun = process.argv.includes("--dry-run");
  if (isDryRun) console.log("DRY RUN — no changes will be written\n");
  console.log("Scanning all collections for numeric `start` fields...\n");

  const toFix = [];
  for (const col of COLLECTIONS) {
    const snapshot = await db.collection(col).get();
    for (const docSnap of snapshot.docs) {
      const data = docSnap.data();
      if (typeof data.start === "number") {
        toFix.push({
          collection: col, id: docSnap.id, numericStart: data.start, data,
        });
      }
    }
  }

  if (toFix.length === 0) {
    console.log("No documents with numeric start fields found. Nothing to do.");
    return;
  }

  console.log(`Found ${toFix.length} document(s) to fix:\n`);
  for (const item of toFix) {
    console.log(`  ${item.collection} / ${item.id}`);
    const humanDate = new Date(item.numericStart).toISOString();
    console.log(`    start: ${item.numericStart}  →  Timestamp (${humanDate})`);
  }

  // Write pre-fix backup
  const runId = new Date().toISOString().slice(0, 19).replace(/:/g, "-");
  const beforePath = `${__dirname}/fix-before-${runId}.json`;
  writeFileSync(
    beforePath,
    JSON.stringify(
      toFix.map(({id, collection, data}) => ({
        id, collection, data: serialize(data),
      })),
      null, 4,
    ),
  );
  console.log(`\nPre-fix backup saved to: scripts/fix-before-${runId}.json`);

  if (isDryRun) {
    console.log("\nDry run complete. Run without --dry-run to apply changes.");
    return;
  }

  console.log();
  const ok = await confirm(`Apply ${toFix.length} update(s)? [y/N] `);
  if (!ok) {
    console.log("Aborted.");
    return;
  }

  console.log("\nApplying updates...");
  let successCount = 0;
  let errorCount = 0;

  for (const item of toFix) {
    try {
      await db.collection(item.collection).doc(item.id).update({
        start: Timestamp.fromMillis(item.numericStart),
      });
      console.log(`  ✓ ${item.collection} / ${item.id}`);
      successCount++;
    } catch (error) {
      console.error(`  ✗ ${item.collection} / ${item.id}: ${error.message}`);
      errorCount++;
    }
  }

  console.log(`\nDone: ${successCount} updated, ${errorCount} failed`);

  // Re-fetch updated documents and write post-fix snapshot
  const afterData = [];
  for (const item of toFix) {
    try {
      const snap = await db.collection(item.collection).doc(item.id).get();
      afterData.push({
        id: item.id, collection: item.collection, data: serialize(snap.data()),
      });
    } catch (error) {
      const msg = `${item.collection} / ${item.id}: ${error.message}`;
      console.error(`  Could not re-fetch ${msg}`);
    }
  }

  const afterPath = `${__dirname}/fix-after-${runId}.json`;
  writeFileSync(afterPath, JSON.stringify(afterData, null, 4));
  console.log(`Post-fix snapshot saved to: scripts/fix-after-${runId}.json`);
};

// Command dispatch
const command = process.argv[2];
if (command === "pull") await pull();
else if (command === "fix") await fix();
else console.error("Usage: node scripts/timestamp-fix.js pull|fix [--dry-run]");

await shutdown();

process.exit(0);
