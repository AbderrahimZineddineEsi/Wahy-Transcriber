import { defineConfig, devices } from "@playwright/test";
import { existsSync, readdirSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";

// The smoke test runs against a real server (own temp data folder and .env, port 8121) and the real web app
// (port 5174), so it never touches data/wahy.db or the real keys.
const dataDir = join(tmpdir(), "wahy-e2e");
const repo = resolve(import.meta.dirname, "..");
// The prepared corpus is big (90 MB): the test server reads the real one instead of preparing its own.
const corpus = join(repo, "data", "corpus.json");
// WAHY_E2E_LIVE=1 runs the live YouTube test: the server then uses the real .env keys (still its own database).
const live = process.env.WAHY_E2E_LIVE === "1";

// Playwright wants the exact browser build it was released with. If another build is already installed
// (~/.cache/ms-playwright), use that one instead of downloading.
function installedChromium(): string | undefined {
  if (process.env.PLAYWRIGHT_CHROMIUM_PATH) return process.env.PLAYWRIGHT_CHROMIUM_PATH;
  const root = join(homedir(), ".cache", "ms-playwright");
  if (!existsSync(root)) return undefined;
  for (const dir of readdirSync(root).filter((d) => d.startsWith("chromium-")).sort().reverse()) {
    const exe = join(root, dir, "chrome-linux64", "chrome");
    if (existsSync(exe)) return exe;
  }
  return undefined;
}

export default defineConfig({
  testDir: "e2e",
  // live-*: real APIs (WAHY_E2E_LIVE=1); perf-*: the 2-hour lecture measurement (WAHY_E2E_PERF=1), slow
  testIgnore: [...(live ? [] : ["**/live-*.spec.ts"]), ...(process.env.WAHY_E2E_PERF === "1" ? [] : ["**/perf-*.spec.ts"])],
  timeout: live || process.env.WAHY_E2E_PERF === "1" ? 600_000 : 30_000,
  fullyParallel: false,
  workers: 1,
  use: { baseURL: "http://127.0.0.1:5174", trace: "retain-on-failure" },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], launchOptions: { executablePath: installedChromium() } },
    },
  ],
  webServer: [
    {
      command: `rm -rf ${dataDir} && mkdir -p ${dataDir} && cd ../server && uv run uvicorn wahy.main:app --host 127.0.0.1 --port 8121`,
      url: "http://127.0.0.1:8121/api/health",
      // keys from the developer's shell must not leak in: an empty value counts as "not set"
      env: {
        WAHY_DATA_DIR: dataDir,
        ...(existsSync(corpus) ? { WAHY_CORPUS_PATH: corpus } : {}),
        ...(live
          ? { WAHY_ENV_FILE: join(repo, ".env") }
          : { WAHY_ENV_FILE: join(dataDir, ".env"), GROQ_API_KEY: "", GEMINI_API_KEY: "", OPENROUTER_API_KEY: "", JEV_API_KEY: "" }),
      },
      timeout: 60_000,
      reuseExistingServer: false,
    },
    {
      command: "npx vite --port 5174 --strictPort --host 127.0.0.1",
      url: "http://127.0.0.1:5174",
      env: { WAHY_API: "http://127.0.0.1:8121" },
      reuseExistingServer: false,
    },
  ],
});
