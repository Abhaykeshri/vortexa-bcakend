import { spawn } from "node:child_process";

const services = [
  ["API", "dist/apps/api/src/main.js"],
  ["INDEXER", "dist/apps/indexer/src/main.js"],
  ["OUTBOX", "dist/apps/outbox/src/main.js"],
];

const children = [];
let stopping = false;

function stopAll() {
  if (stopping) return;
  stopping = true;

  for (const child of children) {
    if (child.exitCode === null) {
      child.kill();
    }
  }
}

for (const [name, script] of services) {
  const child = spawn(process.execPath, [script], {
    stdio: "inherit",
    env: process.env,
  });

  children.push(child);

  child.on("error", (error) => {
    console.error(`[${name}] ${error.message}`);
    stopAll();
    process.exitCode = 1;
  });

  child.on("exit", (code, signal) => {
    if (!stopping) {
      console.error(`[${name}] stopped: ${signal ?? code}`);
      stopAll();
      process.exitCode = 1;
    }
  });
}

process.on("SIGINT", stopAll);
process.on("SIGTERM", stopAll);