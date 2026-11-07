// Takes the README screenshots (docs/screenshots/) from a running server with the built web app.
//   npm run build --workspace web
//   (cd server && WAHY_DATA_DIR=/tmp/shots uv run uvicorn wahy.main:app --port 8130)   # an empty data folder
//   node web/scripts/screenshots.mjs http://127.0.0.1:8130
// It creates the sample lecture, runs detection, then saves one picture per screen. Uses no AI provider.
import { chromium } from "@playwright/test";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const base = process.argv[2] ?? "http://127.0.0.1:8130";
const out = resolve(import.meta.dirname, "..", "..", "docs", "screenshots");

function chromiumPath() {
  const root = join(homedir(), ".cache", "ms-playwright");
  if (!existsSync(root)) return undefined;
  for (const d of readdirSync(root).filter((x) => x.startsWith("chromium-")).sort().reverse()) {
    const exe = join(root, d, "chrome-linux64", "chrome");
    if (existsSync(exe)) return exe;
  }
}

const api = async (path, init) => (await fetch(base + path, { headers: { "content-type": "application/json" }, ...init })).json();
const lecture = await api("/api/lectures/sample", { method: "POST" });
const detect = await api(`/api/lectures/${lecture.id}/detect`, { method: "POST", body: "{}" });
if (detect.job) for (let i = 0; i < 120; i++) { // wait for the detection job
  const job = await api(`/api/jobs/${detect.job.id}`);
  if (job.status === "failed") throw new Error(job.error);
  if (!["queued", "running"].includes(job.status)) break;
  await new Promise((r) => setTimeout(r, 500));
}

const browser = await chromium.launch({ executablePath: chromiumPath() });
const shots = [
  ["01-lectures", "/lectures", "light"],
  ["02-lecture-dark", `/lectures/${lecture.id}`, "dark"],
  ["03-lecture-light", `/lectures/${lecture.id}`, "light"],
  ["04-editor", `/lectures/${lecture.id}/edit`, "dark"],
  ["05-export", `/lectures/${lecture.id}/export`, "light"],
  ["06-corpora", "/corpora", "dark"],
];
for (const [name, path, theme] of shots) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript((t) => { try { localStorage.setItem("wahy.theme", t); } catch {} }, theme);
  const page = await ctx.newPage();
  await page.emulateMedia({ colorScheme: theme });
  await page.goto(base + path);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(600);
  await page.screenshot({ path: join(out, `${name}.png`) });
  await ctx.close();
}
await browser.close();
console.log("saved", shots.length, "screenshots in", out);
