import { spawn } from "node:child_process";
import { cp, access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const standaloneRoot = path.join(projectRoot, ".next", "standalone");

await access(path.join(standaloneRoot, "server.js"));
await cp(path.join(projectRoot, ".next", "static"), path.join(standaloneRoot, ".next", "static"), { recursive: true, force: true });
await cp(path.join(projectRoot, "public"), path.join(standaloneRoot, "public"), { recursive: true, force: true });

const server = spawn(process.execPath, ["server.js"], {
  cwd: standaloneRoot,
  env: process.env,
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
