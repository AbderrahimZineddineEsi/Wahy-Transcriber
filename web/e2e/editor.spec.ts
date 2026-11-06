import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";

// Phase 17's feature check, on the real server and engine: in the editor, add a missed quote with two clicks; it
// shows in the transcript and the captions; the header's undo removes it. Then the export tab downloads exactly the
// server's file.

type Word = { idx: number; text: string; start: number; end: number };
type Finding = { id: number; word_start: number; word_end: number };

async function sample(request: APIRequestContext): Promise<{ id: number; words: Word[] }> {
  const lecture = await (await request.post("/api/lectures/sample")).json();
  const { job } = await (await request.post(`/api/lectures/${lecture.id}/detect`)).json();
  await expect.poll(async () => (await (await request.get(`/api/jobs/${job.id}`)).json()).status, { timeout: 60_000 }).toBe("done");
  return { id: lecture.id, words: lecture.words };
}

const findings = async (request: APIRequestContext, id: number): Promise<Finding[]> =>
  (await (await request.get(`/api/lectures/${id}/findings`)).json()).findings;

/** Three words in a row that no finding covers, away from the start. */
function plainRun(words: Word[], found: Finding[]): number {
  const covered = (i: number) => found.some((f) => f.word_start <= i && i <= f.word_end);
  for (let i = 20; i + 2 < words.length; i++) if (!covered(i) && !covered(i + 1) && !covered(i + 2)) return i;
  throw new Error("no plain words in the sample");
}

const boardWord = (page: Page, i: number) => page.getByTestId("board").locator(`[data-i="${i}"]`);

test("a missed quote with two clicks shows in the transcript and the captions, and undo removes it", async ({ page, request }) => {
  const { id, words } = await sample(request);
  const before = await findings(request, id);
  const a = plainRun(words, before);
  const b = a + 2;

  await page.goto(`/lectures/${id}/edit`);
  await expect(page.getByTestId("undo")).toHaveAccessibleName("لا شيء للتراجع");
  await boardWord(page, a).click();
  await boardWord(page, b).click();
  await expect(boardWord(page, a)).toHaveClass(/rsel/);
  await expect(boardWord(page, a + 1)).toHaveClass(/rsel/);
  const studio = page.getByTestId("studio");
  await expect(studio.getByTestId("studio-words")).toHaveText(words.slice(a, b + 1).map((w) => w.text).join(" "));
  // ordinary speech matches no reference well: the studio offers "outside the sources" or its closest guess;
  // insert it as an outside quote with a typed reference, so the test does not depend on the ranking
  await studio.getByRole("radio", { name: "اقتباس من خارج المصادر" }).check();
  await studio.getByRole("textbox", { name: "المرجع المكتوب" }).fill("اختبار");
  await studio.getByRole("button", { name: "إدراج الاقتباس" }).click();
  await expect(page.getByText("أضيف الاقتباس: اختبار")).toBeVisible();
  await expect(page.getByTestId("inspector").getByTestId("insp-ref")).toHaveText("اختبار");
  await expect(page.getByTestId("undo")).toHaveAccessibleName("تراجع: إضافة اقتباس فائت");

  // on the server: one more finding over exactly those words, and a quote caption for it
  const added = (await findings(request, id)).find((f) => f.word_start === a && f.word_end === b);
  expect(added).toBeTruthy();
  const captions = await (await request.get(`/api/lectures/${id}/captions`)).json();
  expect(captions.some((c: { wordStartIdx: number; type: string; displayText: string }) => c.wordStartIdx === a && c.type !== "normal" && c.displayText.includes("اختبار"))).toBe(true);

  // in the view: the words are a quote in the transcript, and the caption over the video shows it
  await page.getByRole("link", { name: /^العرض/ }).click();
  const transcript = page.getByTestId("transcript");
  await expect(transcript.locator(`.f [data-i="${a}"]`)).toHaveCount(1);
  await expect(transcript.locator(`.f:has([data-i="${a}"]) .ref`)).toHaveText(/اختبار/);
  await transcript.locator(`[data-i="${a}"]`).click();
  await expect(page.getByTestId("caption")).toContainText("اختبار");

  // undo (the header button names the edit), and it is gone everywhere
  await page.getByTestId("undo").click();
  await expect(page.getByText("تم التراجع: إضافة اقتباس فائت")).toBeVisible();
  await expect(transcript.locator(`.f [data-i="${a}"]`)).toHaveCount(0);
  await expect(page.getByTestId("caption")).not.toContainText("اختبار");
  expect((await findings(request, id)).length).toBe(before.length);
  await expect(page.getByTestId("undo")).toHaveAccessibleName("لا شيء للتراجع");
});

test("the export tab downloads the server's SRT, and a bracket change reaches the transcript", async ({ page, request }) => {
  const { id } = await sample(request);
  await page.goto(`/lectures/${id}/export`);
  await expect(page.getByTestId("export-preview")).toContainText("-->");
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("download").click()]);
  expect(download.suggestedFilename()).toBe("wahy-captions.srt");
  const file = readFileSync(await download.path());
  const server = await (await request.get(`/api/lectures/${id}/export/srt?script=spoken&kind=all&show=CORRECT&show=NOT_SURE&show=NONE`)).body();
  expect(file.equals(server)).toBe(true);

  // F-071: verse brackets « » are saved, and the transcript uses them after a reload
  await page.getByRole("combobox", { name: "أقواس الآيات" }).selectOption("« … »");
  await expect(page.getByTestId("export-preview")).toContainText("«");
  await page.goto(`/lectures/${id}`);
  await page.reload();
  await expect(page.getByTestId("transcript").locator(".f.quran .br").first()).toHaveText("«");
  await request.patch("/api/export/style", { data: { quranBracketOpen: "﴿", quranBracketClose: "﴾" } });
});
