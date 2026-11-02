#!/usr/bin/env node
// One command for local testing: the server (:4410) and the client (:1430), with prefixed logs.
import { spawn } from "node:child_process";

const procs = [
  ["server", "npm", ["run", "dev", "-w", "@foundation/server"], "\x1b[35m"],
  ["client", "npm", ["run", "dev", "-w", "@foundation/client"], "\x1b[34m"],
].map(([name, cmd, args, color]) => {
  const p = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"], env: process.env });
  const tag = `${color}${name.padEnd(6)}\x1b[0m │ `;
  const pipe = (s) => s.on("data", (b) => process.stdout.write(b.toString().replace(/^(?=.)/gm, tag)));
  pipe(p.stdout);
  pipe(p.stderr);
  p.on("exit", (code) => {
    console.log(`${tag}exited ${code}`);
    for (const q of procs) q.kill();
    process.exit(code ?? 0);
  });
  return p;
});
process.on("SIGINT", () => procs.forEach((p) => p.kill("SIGINT")));
console.log("\n  Foundation → http://localhost:1430  (server http://localhost:4410)\n");
