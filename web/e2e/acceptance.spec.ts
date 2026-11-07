import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// Phase 23 (acceptance): the `check:` lines of docs/rewrite/features.md that no earlier spec walks in the real app,
// on the real server and engine, offline (the server's fake verifier, no keys). Each test names its feature IDs.

type Word = { idx: number; text: string; start: number; end: number };
type Finding = { id: number; source_type: string; display_ref: string; word_start: number; word_end: number; verdict: { verdict: string; verifier: string } | null };

const repo = resolve(import.meta.dirname, "..", "..");
const golden = (engine: string) =>
  JSON.parse(readFileSync(join(repo, "engine", "golden", "expected", "sample", engine, "findings.json"), "utf8")) as { displayRef: string; sourceType: string }[];

const english = (page: Page) => page.addInitScript(() => window.localStorage.setItem("wahy.lang", "en"));

async function waitJob(request: APIRequestContext, id: string) {
  await expect.poll(async () => (await (await request.get(`/api/jobs/${id}`)).json()).status, { timeout: 60_000 }).toBe("done");
}

async function detectedSample(request: APIRequestContext, engine?: string): Promise<{ id: number; words: Word[] }> {
  const lecture = await (await request.post("/api/lectures/sample")).json();
  const { job } = await (await request.post(`/api/lectures/${lecture.id}/detect`, engine ? { data: { engine } } : {})).json();
  await waitJob(request, job.id);
  return { id: lecture.id, words: lecture.words };
}

async function pasted(request: APIRequestContext, text: string): Promise<number> {
  const lecture = await (await request.post("/api/lectures", { data: { text, title: null, filename: "" } })).json();
  const { job } = await (await request.post(`/api/lectures/${lecture.id}/detect`)).json();
  await waitJob(request, job.id);
  return lecture.id;
}

const findings = async (request: APIRequestContext, id: number): Promise<Finding[]> =>
  (await (await request.get(`/api/lectures/${id}/findings`)).json()).findings;

const setDetection = (request: APIRequestContext, body: Record<string, unknown>) => request.patch("/api/detection/settings", { data: body });

function tone(seconds: number): Buffer {
  const file = join(tmpdir(), `wahy-e2e-tone-${seconds}s.webm`);
  if (!existsSync(file)) {
    execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-f", "lavfi", "-i", `sine=f=440:d=${seconds}`, "-c:a", "libopus", "-b:a", "16k", file]);
  }
  return readFileSync(file);
}

test.afterEach(async ({ request }) => {
  await setDetection(request, { engine: "v5", qiraat: "AUTO", adhkar: true });
});

test("F-001: the rail's badges show the same counts as the screens", async ({ page, request }) => {
  await english(page);
  const { id } = await detectedSample(request);
  const found = await findings(request, id);
  const adhkar = (await (await request.get("/api/corpora/adhkar")).json()).length;
  const training = (await (await request.get("/api/training?limit=1")).json()).counts.total;
  const requests = (await (await request.get("/api/telemetry/requests?limit=1")).json()).total;

  await page.goto(`/lectures/${id}`);
  await expect(page.getByTestId("rail-badge-lecture")).toHaveText(String(found.length));
  await expect(page.getByRole("link", { name: /^View/ }).locator(".badge")).toHaveText(String(found.length));
  await expect(page.getByTestId("rail-badge-corpora")).toHaveText(String(adhkar));
  await expect(page.getByTestId("rail-badge-training")).toHaveText(String(training));
  await expect(page.getByTestId("rail-badge-requests")).toHaveText(String(requests));
  await page.goto("/corpora");
  await expect(page.getByTestId("corpora-count-adhkar")).toHaveText(String(adhkar));

  // a change on one screen moves the badge: a dhikr added in the corpora screen
  await page.getByTestId("dhikr-new").fill("سبحان ربي العظيم وبحمده اختبار");
  await page.getByTestId("dhikr-add").click();
  await expect(page.getByTestId("rail-badge-corpora")).toHaveText(String(adhkar + 1));
  const added = (await (await request.get("/api/corpora/adhkar")).json()).find((d: { t: string }) => d.t.includes("اختبار"));
  await request.delete(`/api/corpora/adhkar/${added.id}`);
});

test("F-002, F-008: the theme survives a reload; in English the menus are English and left to right, the transcript stays Arabic", async ({ page, request }) => {
  const { id } = await detectedSample(request);
  await page.goto(`/lectures/${id}`);
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await page.getByRole("button", { name: "Language", exact: false }).or(page.getByRole("button", { name: "اللغة" })).click();
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  await expect(page.getByRole("link", { name: "Settings" })).toBeVisible();
  await expect(page.getByTestId("transcript")).toContainText("الحمد");
  const theme = page.getByRole("button", { name: "Theme: light or dark" });
  const before = await page.locator("html").getAttribute("data-theme");
  await theme.click();
  const after = await page.locator("html").getAttribute("data-theme");
  expect(after).not.toBe(before);
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", after!);
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
});

test("F-004: when the server does not answer, the header says so", async ({ page }) => {
  await english(page);
  await page.goto("/lectures");
  await expect(page.getByTestId("server-badge")).toHaveAttribute("data-state", "ok");
  await page.route("**/api/health", (route) => route.abort());
  await page.reload();
  await expect(page.getByTestId("server-badge")).toHaveAttribute("data-state", "bad", { timeout: 15_000 });
  await expect(page.getByTestId("server-badge")).toContainText("Cannot reach the server");
});

test("F-007: after an edit and a reload, the app opens the same lecture with the edit", async ({ page, request }) => {
  await english(page);
  const { id, words } = await detectedSample(request);
  await page.goto(`/lectures/${id}`);
  await expect(page.getByTestId("transcript")).toBeVisible();
  // correct a word in place (F-041): double-click, type, Enter
  await page.getByTestId("transcript").locator('[data-i="0"]').dblclick();
  const editor = page.getByTestId("word-editor").locator("input");
  await editor.fill("كلمةمصححة");
  await editor.press("Enter");
  await expect(page.getByTestId("transcript").locator('[data-i="0"]')).toHaveText("كلمةمصححة");
  const fixed = (await (await request.get(`/api/lectures/${id}`)).json()).words[0];
  expect([fixed.start, fixed.end]).toEqual([words[0].start, words[0].end]); // its timing is kept
  await page.goto("/");
  await expect(page).toHaveURL(new RegExp(`/lectures/${id}$`));
  await expect(page.getByTestId("transcript").locator('[data-i="0"]')).toHaveText("كلمةمصححة");
});

test("F-011, F-044, F-028: v5:loose found again equals the golden findings; a v4 run keeps a version that still shows the old ones", async ({ page, request }) => {
  await english(page);
  const { id } = await detectedSample(request);
  await page.goto("/settings");
  await page.getByTestId("engine-v5:loose").click();
  await expect(page.getByTestId("engine-v5:loose")).toHaveAttribute("aria-pressed", "true");

  await page.goto(`/lectures/${id}`);
  const again = page.getByTestId("detect-again");
  await expect(again).toHaveText("Detect the quotes again (v5:loose)");
  await again.click();
  await again.click(); // the second click confirms
  await expect(page.getByTestId("detect-again-status")).toHaveAttribute("data-status", "done", { timeout: 60_000 });
  const loose = await findings(request, id);
  expect(loose.map((f) => f.display_ref)).toEqual(golden("v5-loose").map((f) => f.displayRef));
  await expect(page.getByTestId("rail-badge-lecture")).toHaveText(String(loose.length));

  await setDetection(request, { engine: "v4" });
  await page.reload();
  await expect(again).toHaveText("Detect the quotes again (v4)");
  await again.click();
  await again.click();
  await expect(page.getByTestId("detect-again-status")).toHaveAttribute("data-status", "done", { timeout: 60_000 });
  expect((await findings(request, id)).map((f) => f.display_ref)).toEqual(golden("v4").map((f) => f.displayRef));
  await expect(page.getByTestId("rail-badge-lecture")).toHaveText(String(golden("v4").length));

  // the picker has a version from before each run; the newest one holds the v5:loose findings
  const versions = (await (await request.get(`/api/lectures/${id}/versions`)).json()) as { id: number; name: string }[];
  expect(versions.length).toBeGreaterThanOrEqual(2);
  const newest = versions[versions.length - 1];
  await page.getByLabel("Version").selectOption(String(newest.id));
  await expect(page.getByText(/You are viewing the saved version/)).toBeVisible();
  await expect(page.getByTestId("transcript").locator(".ref")).toHaveCount(golden("v5-loose").length);
  await page.getByRole("button", { name: "Back to current" }).click();
  await expect(page.getByTestId("transcript").locator(".ref")).toHaveCount(golden("v4").length);
});

test("F-012: with Warsh chosen in Settings, a verse read in Warsh's reading is found", async ({ page, request }) => {
  await english(page);
  await page.goto("/settings");
  await page.getByTestId("qiraat").selectOption("warsh");
  await expect.poll(async () => (await (await request.get("/api/detection/settings")).json()).qiraat).toBe("warsh");
  // al-Fatiha 4 in Warsh's reading: «ملك يوم الدين» (Hafs reads «مالك»)
  const id = await pasted(request, "قال الله تعالى الحمد لله رب العالمين الرحمن الرحيم ملك يوم الدين إياك نعبد وإياك نستعين ثم قال الشيخ كلاما");
  const found = await findings(request, id);
  expect(found.some((f) => f.source_type === "QURAN" && /الفاتحة/.test(f.display_ref))).toBe(true);
});

test("F-018: an imported .vtt file gives words with the file's timings", async ({ page, request }) => {
  await english(page);
  const vtt = "WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nبسم الله الرحمن الرحيم\n\n00:00:05.500 --> 00:00:08.000\nقل هو الله أحد\n";
  await page.goto("/lectures");
  await page.getByRole("button", { name: /Text file/ }).click();
  await page.locator("#text-file").setInputFiles({ name: "test.vtt", mimeType: "text/vtt", buffer: Buffer.from(vtt) });
  await page.getByRole("button", { name: "Create the lecture" }).click();
  await expect(page.getByTestId("job-detect")).toHaveAttribute("data-status", "done", { timeout: 60_000 });
  await page.getByTestId("job-detect").getByRole("link", { name: "Open the lecture" }).click();
  const id = Number(page.url().split("/").pop());
  const words = (await (await request.get(`/api/lectures/${id}`)).json()).words as Word[];
  expect(words[0].start).toBeCloseTo(1, 1);
  expect(words[4].start).toBeCloseTo(5.5, 1); // «قل», the first word of the second cue
  expect(words[words.length - 1].end).toBeCloseTo(8, 1);
});

test("F-026: a pasted-text lecture gets its audio attached, and clicking a word seeks the audio", async ({ page, request }) => {
  await english(page);
  const id = await pasted(request, "إن الحمد لله نحمده ونستعينه ونستغفره ونعوذ بالله من شرور أنفسنا ومن سيئات أعمالنا من يهده الله فلا مضل له ومن يضلل فلا هادي له");
  await page.goto(`/lectures/${id}`);
  await page.locator('input[type=file][accept="audio/*,video/*"]').setInputFiles({ name: "talk.webm", mimeType: "audio/webm", buffer: tone(30) });
  await expect(page.getByText("Media attached")).toBeVisible();
  const media = page.getByTestId("media");
  await expect(media).toBeAttached();
  const words = (await (await request.get(`/api/lectures/${id}`)).json()).words as Word[];
  const i = 12;
  await page.getByTestId("transcript").locator(`[data-i="${i}"]`).click();
  await expect.poll(() => media.evaluate((m: HTMLMediaElement) => m.currentTime)).toBeCloseTo(words[i].start, 1);
});

test("F-029, F-031, F-034, F-035, F-030: counts equal the golden findings; kind filter, search and layout", async ({ page, request }) => {
  await english(page);
  const { id } = await detectedSample(request);
  const gold = golden("v5");
  await page.goto(`/lectures/${id}`);
  await expect(page.getByTestId("count-quran")).toHaveText(String(gold.filter((f) => f.sourceType === "QURAN").length));
  await expect(page.getByTestId("count-hadith")).toHaveText(String(gold.filter((f) => f.sourceType === "HADITH").length));
  await expect(page.getByTestId("count-dhikr")).toHaveText(String(gold.filter((f) => f.sourceType === "ADHKAR").length));
  await expect(page.getByTestId("transcript").locator(".ref")).toHaveCount(gold.length);

  await expect(page.getByTestId("transcript").locator(".ref").first()).toBeVisible();
});

test("F-038: standard script shows a misheard verse's source text in the transcript and the SRT", async ({ page, request }) => {
  await english(page);
  // al-Ikhlas as an ASR would write it: no diacritics, «احد» without its hamza
  const id = await pasted(request, "قال الله تعالى قل هو الله احد الله الصمد لم يلد ولم يولد ولم يكن له كفوا احد فهذه سورة الإخلاص");
  await page.goto(`/lectures/${id}`);
  await expect(page.getByTestId("transcript").locator(".ref").first()).toContainText("الإخلاص");
  await expect(page.getByTestId("transcript")).not.toContainText("أَحَدٌ");
  await page.getByLabel("Standard script").check();
  await expect(page.getByTestId("transcript")).toContainText("أَحَدٌ");
  await page.getByRole("link", { name: /^Export/ }).click();
  await expect(page.getByTestId("export-preview")).toContainText("-->");
  await expect(page.getByTestId("export-preview")).toContainText("أَحَدٌ");
  expect(await (await request.get(`/api/lectures/${id}/export/srt?script=standard`)).text()).toContain("أَحَدٌ");
  expect(await (await request.get(`/api/lectures/${id}/export/srt`)).text()).not.toContain("أَحَدٌ");
  await page.getByLabel("Standard script").uncheck();
});

test("F-054, F-073: a phrase saved as a dhikr from the editor is in the adhkar list and found by the next detection (engine v3)", async ({ page, request }) => {
  await english(page);
  await setDetection(request, { engine: "v3" });
  const phrase = ["اللهم", "بارك", "لنا", "في", "مجلسنا"]; // in no corpus
  const id = await pasted(request, `قال الشيخ في الدرس ${phrase.join(" ")} ثم أكمل الشيخ كلامه في الدرس`);
  const words = (await (await request.get(`/api/lectures/${id}`)).json()).words as Word[];
  const a = words.findIndex((w) => w.text === phrase[0]);
  await page.goto(`/lectures/${id}/edit`);
  const board = page.getByTestId("board");
  await board.locator(`[data-i="${a}"]`).click();
  await board.locator(`[data-i="${a + 4}"]`).click();
  await page.getByTestId("seltool").getByRole("button", { name: "Save as a dhikr" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect.poll(async () => ((await (await request.get("/api/corpora/adhkar")).json()) as { t: string }[]).some((d) => d.t === phrase.join(" "))).toBe(true);
  const list = (await (await request.get("/api/corpora/adhkar")).json()) as { id: number; t: string }[];
  const saved = list.find((d) => d.t === phrase.join(" "));
  await expect.poll(async () => (await findings(request, id)).some((f) => f.source_type === "ADHKAR" && f.word_start === a), { timeout: 30_000 }).toBe(true);
  await expect(page.getByText(/in the adhkar list and marked the words with it/)).toBeVisible();

  // the next detection, in another lecture that says it, finds it as a dhikr
  const other = await pasted(request, `وكان يقول ${phrase.join(" ")} وهذا من الأذكار`);
  expect((await findings(request, other)).some((f) => f.source_type === "ADHKAR")).toBe(true);
  await request.delete(`/api/corpora/adhkar/${saved!.id}`);
});

test("F-075: a custom quote added in the corpora screen is found by the next detection", async ({ page, request }) => {
  await english(page);
  const text = "العلم قبل القول والعمل فاعلموا ذلك يا طلاب العلم";
  await page.goto("/corpora/quotes");
  await page.getByTestId("quote-new").fill(text);
  await page.getByTestId("quote-add").click();
  await expect(page.getByTestId("quote-row").filter({ hasText: "العلم قبل القول" })).toBeVisible();
  const id = await pasted(request, `قال الإمام البخاري ${text} ثم شرح الشيخ هذا الكلام`);
  const found = await findings(request, id);
  expect(found.some((f) => f.word_end - f.word_start >= 5)).toBe(true);
  const quotes = (await (await request.get("/api/corpora/custom-quotes")).json()) as { id: number; text: string }[];
  for (const q of quotes.filter((x) => x.text === text)) await request.delete(`/api/corpora/custom-quotes/${q.id}`);
});

test("F-074: export the adhkar, reset, import the export: the list is back as before", async ({ page, request }) => {
  await english(page);
  const before = ((await (await request.get("/api/corpora/adhkar")).json()) as { t: string }[]).map((d) => d.t).sort();
  expect((await request.post("/api/corpora/adhkar", { data: { t: "اللهم اغفر لي ولوالدي اختبار", ref: "اختبار" } })).ok()).toBe(true);
  const mine = ((await (await request.get("/api/corpora/adhkar")).json()) as { t: string }[]).map((d) => d.t).sort();
  await page.goto("/corpora");
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Export JSON" }).or(page.getByRole("link", { name: "Export JSON" })).click()]);
  const file = await download.path();
  const reset = page.getByTestId("adhkar-reset");
  await reset.click();
  await reset.click();
  await expect(page.getByText("The 18 initial adhkar are back")).toBeVisible();
  await page.getByTestId("adhkar-import").setInputFiles(file!);
  await expect(page.getByText(/added, .* skipped/)).toBeVisible();
  const after = ((await (await request.get("/api/corpora/adhkar")).json()) as { t: string }[]).map((d) => d.t).sort();
  expect(after).toEqual(mine);
  const extra = ((await (await request.get("/api/corpora/adhkar")).json()) as { id: number; t: string }[]).find((d) => d.t.includes("اختبار"));
  await request.delete(`/api/corpora/adhkar/${extra!.id}`);
  expect(before.length).toBeGreaterThan(0);
});

test("F-059, F-058, F-064: the inspector moves an edge and changes the kind; deleting as ordinary speech makes a gold false label", async ({ page, request }) => {
  await english(page);
  const { id } = await detectedSample(request);
  const before = await findings(request, id);
  const verse = before.find((f) => f.display_ref.includes("الأحزاب"))!;
  await page.goto(`/lectures/${id}/edit?finding=${verse.id}`);
  const insp = page.getByTestId("inspector");
  await expect(insp.getByTestId("insp-ref")).toContainText("الأحزاب");
  await insp.getByRole("button", { name: "−1 word" }).first().click(); // the start, one word earlier
  await expect.poll(async () => (await findings(request, id)).find((f) => f.id === verse.id)?.word_start).toBe(verse.word_start - 1);
  // the captions follow: the quote's caption starts at the new first word
  const captions = (await (await request.get(`/api/lectures/${id}/captions`)).json()) as { wordStartIdx: number; type: string }[];
  expect(captions.some((c) => c.type !== "normal" && c.wordStartIdx === verse.word_start - 1)).toBe(true);
  await page.getByRole("button", { name: /^Undo/ }).first().click();
  await expect.poll(async () => (await findings(request, id)).find((f) => f.id === verse.id)?.word_start).toBe(verse.word_start);

  await insp.locator("select").filter({ has: page.locator('option[value="hadith"]') }).selectOption("hadith");
  await expect.poll(async () => (await findings(request, id)).find((f) => f.id === verse.id)?.source_type).toBe("HADITH");
  await page.getByRole("button", { name: /^Undo/ }).first().click();
  await expect.poll(async () => (await findings(request, id)).find((f) => f.id === verse.id)?.source_type).toBe("QURAN");

  await insp.getByRole("button", { name: "Delete…" }).click();
  await page.getByRole("dialog").getByRole("button", { name: /Ordinary speech/ }).click();
  await expect.poll(async () => (await findings(request, id)).some((f) => f.id === verse.id)).toBe(false);
  const rows = (await (await request.get(`/api/training?origin=gold&lecture_id=${id}`)).json()).rows as { reference: string; label: string }[];
  expect(rows.some((r) => JSON.stringify(r).includes("الأحزاب") && JSON.stringify(r).includes("FALSE"))).toBe(true);
});

test("F-084, F-066: three quotes picked by hand are exactly the ones verified; one quote verified from the editor adds one request", async ({ page, request }) => {
  await english(page);
  expect((await request.patch("/api/verification/settings", { data: { provider: "fake" } })).ok()).toBe(true);
  const { id } = await detectedSample(request);
  const all = await findings(request, id);
  await page.goto(`/lectures/${id}/verify`);
  const rows = page.getByTestId("finding-row");
  await expect(rows.first()).toBeVisible();
  await page.getByRole("button", { name: "Select none" }).click();
  const picked = all.slice(0, 3).map((f) => f.id);
  for (const f of picked) await rows.locator(`xpath=self::*[@data-id="${f}"]`).locator("input").check();
  await expect(page.getByTestId("picked-count")).toHaveText(`3/${all.length}`);
  await expect(page.getByTestId("est-findings")).toHaveText("3");
  await page.getByRole("button", { name: "Start verification" }).click();
  await expect(page.getByTestId("pass")).toHaveAttribute("data-status", "done", { timeout: 30_000 });
  const after = await findings(request, id);
  expect(after.filter((f) => f.verdict).map((f) => f.id).sort()).toEqual([...picked].sort());

  // F-066: from the editor's inspector, "verify this quote" opens the verify tab with just that one
  const one = all[4];
  const logged = (await (await request.get(`/api/telemetry/requests?lecture_id=${id}`)).json()).total as number;
  await page.goto(`/lectures/${id}/edit?finding=${one.id}`);
  await page.getByTestId("inspector").getByRole("link", { name: "Verify this quote" }).or(page.getByTestId("inspector").getByRole("button", { name: "Verify this quote" })).click();
  await expect(page.getByTestId("picked-count")).toHaveText(`1/${all.length}`);
  await page.getByRole("button", { name: "Start verification" }).click();
  await expect(page.getByTestId("pass")).toHaveAttribute("data-status", "done", { timeout: 30_000 });
  await expect.poll(async () => (await findings(request, id)).find((f) => f.id === one.id)?.verdict?.verifier).toBe("fake");
  expect((await (await request.get(`/api/telemetry/requests?lecture_id=${id}`)).json()).total).toBe(logged + 1);
});

test("F-091, F-104: approve all makes one gold label per verdict; the training filter 'false' lists only false labels", async ({ page, request }) => {
  await english(page);
  await request.delete("/api/training");
  expect((await request.patch("/api/verification/settings", { data: { provider: "fake" } })).ok()).toBe(true);
  const { id } = await detectedSample(request);
  await page.goto(`/lectures/${id}/verify`);
  await page.getByRole("button", { name: "Select shown" }).click();
  await page.getByRole("button", { name: "Start verification" }).click();
  await expect(page.getByTestId("pass")).toHaveAttribute("data-status", "done", { timeout: 30_000 });
  const verdicts = (await findings(request, id)).filter((f) => f.verdict).length;
  const approve = page.getByRole("button", { name: "Approve all verdicts" });
  await approve.click();
  await page.getByRole("button", { name: "Click to confirm: saves gold labels" }).click();
  await expect(page.getByText(`${verdicts} verdicts approved as gold labels`)).toBeVisible();
  const gold = (await (await request.get("/api/training?origin=gold")).json()) as { matching: number; counts: { false: number } };
  expect(gold.matching).toBe(verdicts);

  await page.goto("/training");
  await page.getByLabel("Label", { exact: true }).selectOption("FALSE");
  const shown = page.getByTestId("train-row");
  await expect(shown).toHaveCount(gold.counts.false);
  for (const row of await shown.all()) await expect(row.getByTestId("train-verdict")).toContainText(/Ordinary speech|False/i);
});

test("F-085, F-092, F-086: consecutive verses go as one passage; alone, a verse lists both neighbours; the strict style shows its rule", async ({ page, request }) => {
  await english(page);
  expect((await request.patch("/api/verification/settings", { data: { provider: "gemini" } })).ok()).toBe(true);
  const { id } = await detectedSample(request);
  const all = await findings(request, id);
  const middle = all.find((f) => f.display_ref === "العصر: 2")!;
  const preview = async (passages: boolean) =>
    (await request.post(`/api/lectures/${id}/verification/preview`, {
      data: { finding_id: middle.id, options: { provider: "gemini", prompt: { rules: { passages } } } },
    })).json();
  // F-085: grouping on (the default), the three verses of al-'Asr go out as one passage in one request
  const grouped = await preview(true);
  expect(grouped.finding_ids).toHaveLength(3);
  expect(grouped.state.candidate_reference).toBe("العصر: 1-3");
  // F-092: grouping off, the middle verse goes alone and lists both neighbours
  const alone = await preview(false);
  expect(alone.finding_ids).toEqual([middle.id]);
  expect(alone.state.neighbor_findings.previous.candidate_reference).toBe("العصر: 1");
  expect(alone.state.neighbor_findings.next.candidate_reference).toBe("العصر: 3");

  await page.goto(`/lectures/${id}/verify?finding=${middle.id}`);
  await page.getByText("Model options and instructions").click();
  await page.getByRole("group", { name: "Verdict style" }).getByRole("button", { name: "Strict" }).click();
  await expect(page.getByRole("button", { name: "Strict" })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Preview request" }).click();
  await expect(page.getByTestId("preview")).toContainText("Be strict: only accept verbatim");
  await expect(page.getByTestId("preview-state")).toContainText("العصر");
  await request.patch("/api/verification/settings", { data: { provider: "fake" } });
});

test("F-124: a failed request shows a toast whose details name the endpoint and the error", async ({ page }) => {
  await english(page);
  await page.goto("/settings");
  await page.route("**/api/settings/keys/**", (route) => route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ detail: "disk is full" }) }));
  const row = page.locator("form").filter({ has: page.getByTestId("key-gemini") });
  await row.locator("input").fill("test-key-not-real");
  await row.getByRole("button", { name: "Save" }).click();
  await page.getByRole("button", { name: "Details" }).click();
  const report = page.getByRole("dialog");
  await expect(report).toContainText("/api/settings/keys/");
  await expect(report).toContainText("disk is full");
  await expect(report).not.toContainText("test-key-not-real");
});

// ---- the editor, in the real app ------------------------------------------------------------------------------

const boardWord = (page: Page, i: number) => page.getByTestId("board").locator(`[data-i="${i}"]`);
const lectureWords = async (request: APIRequestContext, id: number): Promise<Word[]> => (await (await request.get(`/api/lectures/${id}`)).json()).words;

/** Three plain words in a row (no finding), away from the start. */
function plainRun(words: Word[], found: Finding[], from = 20): number {
  const covered = (i: number) => found.some((f) => f.word_start <= i && i <= f.word_end);
  for (let i = from; i + 2 < words.length; i++) if (!covered(i) && !covered(i + 1) && !covered(i + 2)) return i;
  throw new Error("no plain words");
}

test("F-048, F-049: the mini player steps 2 seconds; with 'video follows selection' off a click does not move the media", async ({ page, request }) => {
  await english(page);
  const { id, words } = await detectedSample(request);
  const end = Math.ceil(words[words.length - 1].end) + 5;
  expect((await request.put(`/api/lectures/${id}/media`, { multipart: { file: { name: "talk.webm", mimeType: "audio/webm", buffer: tone(end) } } })).ok()).toBe(true);
  await page.goto(`/lectures/${id}/edit`);
  const media = page.getByTestId("media");
  await expect(page.getByTestId("edit-time")).toHaveAttribute("data-ready", "true");
  const now = () => media.evaluate((m: HTMLMediaElement) => m.currentTime);
  await boardWord(page, 40).click();
  await expect.poll(now).toBeCloseTo(words[40].start, 1);
  await page.getByRole("button", { name: "Forward 2 seconds" }).click();
  await expect.poll(now).toBeCloseTo(words[40].start + 2, 1);
  await page.getByRole("button", { name: "Back 2 seconds" }).click();
  await expect.poll(now).toBeCloseTo(words[40].start, 1);
  await page.keyboard.press("Escape");
  await page.getByLabel("Video follows selection").uncheck();
  const before = await now();
  await boardWord(page, 90).click();
  await page.waitForTimeout(300);
  expect(await now()).toBeCloseTo(before, 2);
});

test("F-050: with 'full matn' on, a hadith's whole text shows with its chain dimmed", async ({ page, request }) => {
  await english(page);
  const { id } = await detectedSample(request);
  const hadith = (await findings(request, id)).find((f) => f.display_ref.includes("الأربعون النووية"))!;
  await page.goto(`/lectures/${id}/edit?finding=${hadith.id}`);
  const tokens = page.getByTestId("inspector").getByTestId("insp-tokens");
  await expect(tokens.locator("button").first()).toBeVisible();
  const spokenOnly = await tokens.locator("button").count();
  await expect(tokens.locator("button.sanad")).toHaveCount(0);
  await page.getByLabel("Full matn").check();
  await expect.poll(() => tokens.locator("button.sanad").count()).toBeGreaterThan(0);
  expect(await tokens.locator("button").count()).toBeGreaterThan(spokenOnly);
  await page.getByLabel("Full matn").uncheck();
});

test("F-055, F-056: '+ hadith' opens the hadith search with the selected words; two words rewritten as three keep every other word's time", async ({ page, request }) => {
  await english(page);
  const { id, words } = await detectedSample(request);
  const a = plainRun(words, await findings(request, id));
  await page.goto(`/lectures/${id}/edit`);
  await boardWord(page, a).click();
  await boardWord(page, a + 2).click();
  await page.getByTestId("seltool").getByRole("button", { name: "+ hadith" }).click();
  const studio = page.getByTestId("studio");
  await expect(studio.getByRole("group", { name: "Kind" }).getByRole("button", { name: "Hadith" })).toHaveAttribute("aria-pressed", "true");
  await expect(studio.getByTestId("studio-words")).toHaveText(words.slice(a, a + 3).map((w) => w.text).join(" "));

  // now two words, rewritten as three
  await page.keyboard.press("Escape");
  await boardWord(page, a).click();
  await boardWord(page, a + 1).click();
  await page.getByTestId("seltool").getByRole("button", { name: "Edit words" }).click();
  await page.getByRole("dialog").locator("textarea").fill("كلمة أولى ثالثة");
  await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
  await expect.poll(async () => (await lectureWords(request, id)).length).toBe(words.length + 1);
  const after = await lectureWords(request, id);
  expect(after.slice(a, a + 3).map((w) => w.text)).toEqual(["كلمة", "أولى", "ثالثة"]);
  for (const i of [0, a - 1]) expect([after[i].start, after[i].end]).toEqual([words[i].start, words[i].end]);
  for (const i of [a + 2, words.length - 1]) expect([after[i + 1].start, after[i + 1].end]).toEqual([words[i].start, words[i].end]);
  await page.getByRole("button", { name: /^Undo/ }).first().click();
  await expect.poll(async () => (await lectureWords(request, id)).length).toBe(words.length);
});

test("F-061: a quote linked to another ayah through the search shows the new reference in the inspector and the transcript", async ({ page, request }) => {
  await english(page);
  const { id } = await detectedSample(request);
  const verse = (await findings(request, id)).find((f) => f.display_ref === "الأحزاب: 70")!;
  await page.goto(`/lectures/${id}/edit?finding=${verse.id}`);
  const insp = page.getByTestId("inspector");
  await insp.getByRole("button", { name: "+ reference from search" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.locator('input[type="search"]').fill("الأحزاب: 71");
  await dialog.getByTestId("refsearch-results").getByRole("button", { name: "Link" }).first().click();
  await expect(insp.getByTestId("insp-ref")).toHaveText("الأحزاب: 71");
  await page.getByRole("link", { name: /^View/ }).click();
  await expect(page.getByTestId("transcript").locator(".ref").filter({ hasText: "الأحزاب: 71" })).toHaveCount(1);
  await expect(page.getByTestId("transcript").locator(".ref").filter({ hasText: "الأحزاب: 70" })).toHaveCount(0);
  const srt = await (await request.get(`/api/lectures/${id}/export/srt`)).text();
  expect(srt).toContain("الأحزاب: 71");
});

test("F-062, F-067: the source's words replace a misheard verse with the old timings; a full-text edit keeps the other words' times", async ({ page, request }) => {
  await english(page);
  const id = await pasted(request, "قال الله تعالى قل هو الله احد الله الصمد لم يلد ولم يولد ولم يكن له كفوا احد فهذه سورة الإخلاص نقرؤها كثيرا");
  const words = await lectureWords(request, id);
  const verse = (await findings(request, id)).find((f) => f.source_type === "QURAN")!;
  await page.goto(`/lectures/${id}/edit?finding=${verse.id}`);
  const tokens = page.getByTestId("inspector").getByTestId("insp-tokens").locator("button");
  await expect(tokens.first()).toBeVisible();
  const n = Math.min(await tokens.count(), verse.word_end - verse.word_start + 1);
  for (let k = 0; k < n; k++) await tokens.nth(k).click();
  await page.getByRole("button", { name: `Use these ${n} words` }).click();
  await expect.poll(async () => (await findings(request, id)).find((f) => f.id === verse.id)?.["data" as keyof Finding]).toMatchObject({ snappedToCanonical: true });
  // the view shows the source's words in place of the misheard ones (spoken script), on the same timed words
  await page.getByRole("link", { name: /^View/ }).click();
  await expect(page.getByTestId("transcript")).toContainText("أَحَدٌ");
  const snapped = await lectureWords(request, id);
  expect(snapped.map((w) => [w.start, w.end])).toEqual(words.map((w) => [w.start, w.end]));
  await page.getByRole("link", { name: /^Edit/ }).click();

  // F-067: fix three words of the full text; the others keep their times
  await page.getByRole("button", { name: "Full text" }).click();
  const box = page.getByLabel("Full text", { exact: true }).and(page.locator("textarea"));
  const text = await box.inputValue();
  const fixed = text.replace("فهذه", "وهذه").replace("نقرؤها", "نقرأها").replace("كثيرا", "دائما");
  await box.fill(fixed);
  await page.getByRole("button", { name: "Save and align the words" }).click();
  await expect.poll(async () => (await lectureWords(request, id)).some((w) => w.text === "دائما")).toBe(true);
  const after = await lectureWords(request, id);
  expect(after.length).toBe(snapped.length);
  for (let i = 0; i < after.length; i++) {
    if (["وهذه", "نقرأها", "دائما"].includes(after[i].text)) continue;
    expect([after[i].text, after[i].start, after[i].end]).toEqual([snapped[i].text, snapped[i].start, snapped[i].end]);
  }
  await page.getByRole("group", { name: "Editor modes" }).getByRole("button", { name: "Quotes" }).click(); // leave the editor as it was
});
