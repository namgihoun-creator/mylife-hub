// `npm run dev:e2e` — the normal dev server, wired to the local mock of the Gemini API that `npm run screens` starts on :4010.
// Lets the E2E suite exercise the real zero-typing server code (HTTP call, parsing, fallback) without a Google key or quota.
// The values below are test-only: the key is a placeholder (never a real credential) and the base URL is loopback.
import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const next = require.resolve("next/dist/bin/next");
const child = spawn(process.execPath, [next, "dev"], {
  stdio: "inherit",
  env: { ...process.env, GEMINI_API_KEY: "e2e-mock-key-0123456789abcdef", GEMINI_API_BASE_URL: "http://127.0.0.1:4010" },
});
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill(sig));
child.on("exit", (code) => process.exit(code ?? 0));
