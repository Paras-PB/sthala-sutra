import { spawn } from "node:child_process";
import { cp, access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const standaloneRoot = path.join(projectRoot, ".next", "standalone");
const serverEnvironment = { ...process.env };

// `npm start` is the local standalone path; Compose supplies its own service URL.
// Same default as LOCAL_ARCHIVE_API in src/lib/archive-api.ts — keep the two in step.
const LOCAL_ARCHIVE_API = "http://127.0.0.1:8000";
if (!serverEnvironment.HERITAGE_API_URL?.trim()) {
  serverEnvironment.HERITAGE_API_URL = LOCAL_ARCHIVE_API;
}

await access(path.join(standaloneRoot, "server.js"));
await cp(path.join(projectRoot, ".next", "static"), path.join(standaloneRoot, ".next", "static"), { recursive: true, force: true });
await cp(path.join(projectRoot, "public"), path.join(standaloneRoot, "public"), { recursive: true, force: true });

const server = spawn(process.execPath, ["server.js"], {
  cwd: standaloneRoot,
  env: serverEnvironment,
  stdio: "inherit",
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.kill(signal));
}

server.on("error", (error) => {
  console.error("Could not start the standalone Next.js server:", error.message);
  process.exitCode = 1;
});

server.on("exit", (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
});
