import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { fakeServer, json, renderApp, type Call } from "../../test/render";
import type { LectureDetail } from "../lectures/api";
import { row, sampleWords } from "../lectures/view/fixtures";

const now = "2026-11-06T10:00:00";
const lecture: LectureDetail = {
  id: 1, title: "درس الجمعة", source_kind: "text", source_url: null, has_media: false, duration_s: 7, language: "ar",
  transcription_model: null, word_count: sampleWords.length, version_count: 1, created_at: now, updated_at: now, words: sampleWords,
};
const findings = [
  row({}),
  row({ id: 2, idx: 1, source_type: "HADITH", display_ref: "البخاري (1)", word_start: 10, word_end: 12, verdict: { verdict: "CORRECT", boundary: "MISSING_END", verifier: "gemini", model: "flash", confidence: 0.9, details: null } }),
];
const op = (id: number, kind: string, label: string) => ({ id, kind, label, params: {}, created_at: now, undone: false });
const done = (kind: string, findingId: number | null = 3) => ({ op: op(1, kind, kind), finding_id: findingId, words_changed: false, findings_changed: 1, removed: [], added: [] });
const suggestion = { unitId: "112:2", sourceType: "QURAN", displayRef: "الإخلاص: 2", fullText: "اللَّهُ الصَّمَدُ", score: 14.5, words: ["اللَّهُ", "الصَّمَدُ"], matched: [0] };

let log: ReturnType<typeof op>[] = [];

beforeEach(() => {
  window.localStorage.clear();
  log = [];
});
afterEach(() => vi.unstubAllGlobals());

function server() {
  return fakeServer((call: Call) => {
    const { method, path } = call;
    if (method === "GET" && path === "/api/lectures/1") return json(lecture);
    if (path === "/api/lectures/1/findings") return json({ lecture_id: 1, count: findings.length, findings });
    if (path === "/api/lectures/1/versions") return json([]);
    if (path === "/api/jobs") return json([]);
    if (path === "/api/lectures/1/edits") return json(log);
    if (path === "/api/lectures/1/edits/undo") {
      const [last, ...rest] = log;
      log = rest;
      return json({ op: last });
    }
    if (path === "/api/lectures/1/edits/quote") {
      log = [op(1, "add_quote", "Add a missed quote"), ...log];
      return json(done("add_quote"), 201);
    }
    if (path === "/api/corpus/suggest") return json([suggestion]);
    if (path === "/api/corpus/units") return json({ "112:1": { ref: "الإخلاص: 1", words: ["قُلْ", "هُوَ", "اللَّهُ", "أَحَدٌ"], full: null } });
    if (path.startsWith("/api/findings/") && method === "POST") return json(done("edit", 1));
    if (path.startsWith("/api/findings/") && method === "DELETE") return json(done("delete", 1));
    if (path === "/api/lectures/1/captions")
      return json([
        { index: 1, start: 0, end: 1.4, text: "قال الله تعالى", displayText: "قال الله تعالى", type: "normal", findingId: null, reference: "", wordStartIdx: 0, wordEndIdx: 2, isAtomicCitation: false },
        { index: 2, start: 1.5, end: 3.4, text: "قل هو الله أحد", displayText: "﴿قل هو الله أحد﴾ [الإخلاص: 1]", type: "ayah", findingId: 1, reference: "الإخلاص: 1", wordStartIdx: 3, wordEndIdx: 6, isAtomicCitation: true },
      ]);
    if (path === "/api/lectures/1/edits/captions" && method === "POST") return json(done("caption_split", null));
    if (path === "/api/export/style" && method === "GET") return json({});
    if (path === "/api/export/style" && method === "PATCH") return json(call.body);
    if (path === "/api/lectures/1/export/srt") return new Response("1\n00:00:00,000 --> 00:00:01,400\nقال الله تعالى\n", { headers: { "content-type": "text/plain" } });
  });
}

const board = () => screen.findByTestId("board");
const boardWord = (i: number) => screen.getByTestId("board").querySelector<HTMLElement>(`[data-i="${i}"]`)!;

test("a missed quote with two clicks: the studio ranks the references, inserts it, and undo takes it back", async () => {
  const calls = server();
  renderApp("/lectures/1/edit");
  await board();
  await userEvent.click(boardWord(7));
  expect(screen.getByRole("status")).toHaveTextContent("«ثم»");
  await userEvent.click(boardWord(8));
  expect(boardWord(7)).toHaveClass("rsel");
  expect(boardWord(8)).toHaveClass("rsel");
  const studio = screen.getByTestId("studio");
  expect(within(studio).getByTestId("studio-words")).toHaveTextContent("ثم قال");
  // the best reference is chosen, with the matched words marked in its text
  const best = await within(studio).findByRole("radio", { name: /الإخلاص: 2/ });
  expect(best).toBeChecked();
  expect(within(studio).getByTestId("studio-preview").querySelector(".hit")).toHaveTextContent("اللَّهُ");
  expect(calls.find((c) => c.path === "/api/corpus/suggest")).toBeTruthy();

  await userEvent.click(within(studio).getByRole("button", { name: "إدراج الاقتباس" }));
  await waitFor(() => expect(calls.some((c) => c.path === "/api/lectures/1/edits/quote")).toBe(true));
  expect(calls.find((c) => c.path === "/api/lectures/1/edits/quote")!.body).toEqual({ start: 7, end: 8, unit_id: "112:2", source_type: "QURAN", ref: "", qiraah: "hafs" });
  expect(await screen.findByText("أضيف الاقتباس: الإخلاص: 2")).toBeInTheDocument();

  // the header's undo button names the newest edit
  const undo = await screen.findByTestId("undo");
  await waitFor(() => expect(undo).toHaveAccessibleName("تراجع: إضافة اقتباس فائت"));
  await userEvent.click(undo);
  await waitFor(() => expect(calls.some((c) => c.path === "/api/lectures/1/edits/undo")).toBe(true));
  await waitFor(() => expect(screen.getByTestId("undo")).toHaveAccessibleName("لا شيء للتراجع"));
});

test("outside the sources: nothing matched, so the typed reference is sent", async () => {
  const calls = server();
  vi.stubGlobal("fetch", ((orig) => async (req: Request) => {
    if (new URL(req.url).pathname === "/api/corpus/suggest") return json([{ ...suggestion, score: 0, matched: [] }]);
    return orig(req);
  })(globalThis.fetch));
  renderApp("/lectures/1/edit");
  await board();
  await userEvent.click(boardWord(0));
  await userEvent.click(boardWord(2));
  const studio = screen.getByTestId("studio");
  await waitFor(() => expect(within(studio).getByRole("radio", { name: "اقتباس من خارج المصادر" })).toBeChecked());
  await userEvent.click(within(studio).getByRole("button", { name: "حديث" }));
  await userEvent.type(within(studio).getByRole("textbox", { name: "المرجع المكتوب" }), "رواه أحمد");
  await userEvent.click(within(studio).getByRole("button", { name: "إدراج الاقتباس" }));
  await waitFor(() => expect(calls.some((c) => c.path === "/api/lectures/1/edits/quote")).toBe(true));
  expect(calls.find((c) => c.path === "/api/lectures/1/edits/quote")!.body).toMatchObject({ start: 0, end: 2, unit_id: null, source_type: "HADITH", ref: "رواه أحمد" });
});

test("the inspector walks the quotes and each button is one edit", async () => {
  const calls = server();
  renderApp("/lectures/1/edit");
  await board();
  await userEvent.click(boardWord(4)); // a word of the verse
  const inspector = screen.getByTestId("inspector");
  expect(within(inspector).getByTestId("insp-ref")).toHaveTextContent("الإخلاص: 1");
  expect(within(inspector).getByTestId("insp-pos")).toHaveTextContent("1 / 2");
  // the source words as chips (F-062)
  expect(await within(inspector).findByRole("button", { name: "قُلْ" })).toBeInTheDocument();

  const startGroup = within(inspector).getByText("البداية").parentElement!;
  await userEvent.click(within(startGroup).getByRole("button", { name: "− كلمة" }));
  await waitFor(() => expect(calls.some((c) => c.path === "/api/findings/1/edit")).toBe(true));
  expect(calls.find((c) => c.path === "/api/findings/1/edit")!.body).toEqual({ op: "move_edge", edge: "start", delta: -1 });

  await userEvent.click(within(inspector).getByRole("checkbox", { name: "المرجع خاطئ أو ناقص" }));
  await waitFor(() => expect(calls.filter((c) => c.path === "/api/findings/1/edit").at(-1)!.body).toEqual({ op: "flag_reference", wrong: true }));

  // next: the hadith, with its verifier's confidence and the expand button (its end is missing)
  await userEvent.click(within(inspector).getByRole("button", { name: "الاقتباس التالي" }));
  const second = screen.getByTestId("inspector");
  expect(within(second).getByTestId("insp-ref")).toHaveTextContent("البخاري (1)");
  expect(second).toHaveTextContent("gemini · flash · 90%");
  expect(within(second).getByRole("button", { name: "أكمل الاقتباس" })).toBeInTheDocument();
  // the two are 3 words apart: merging is offered
  expect(within(second).getByTestId("merge-previous")).toHaveTextContent("ثم قال النبي");

  await userEvent.click(within(second).getByRole("button", { name: "حذف…" }));
  const dialog = screen.getByRole("dialog", { name: "لماذا تحذف هذا الاقتباس؟" });
  await userEvent.click(within(dialog).getByRole("button", { name: /كلام عادي/ }));
  await waitFor(() => expect(calls.some((c) => c.method === "DELETE" && c.path === "/api/findings/2")).toBe(true));
});

test("caption timing: split a speech caption at a word; a quote is locked", async () => {
  const calls = server();
  renderApp("/lectures/1/edit");
  await board();
  await userEvent.click(screen.getByRole("button", { name: "توقيت الترجمات" }));
  const rows = await screen.findAllByTestId("caprow");
  expect(rows).toHaveLength(2);
  expect(within(rows[1]).queryByRole("button", { name: "تقسيم" })).toBeNull();
  await userEvent.click(within(rows[0]).getByRole("button", { name: "تقسيم" }));
  await userEvent.click(within(rows[0]).getByRole("button", { name: "تعالى" }));
  await waitFor(() => expect(calls.some((c) => c.path === "/api/lectures/1/edits/captions")).toBe(true));
  expect(calls.find((c) => c.path === "/api/lectures/1/edits/captions")!.body).toEqual({ op: "split", word: 2 });
});

test("export: the preview is the server's file, and the bracket style is saved", async () => {
  const calls = server();
  renderApp("/lectures/1/export");
  const preview = await screen.findByTestId("export-preview");
  await waitFor(() => expect(preview).toHaveTextContent("00:00:00,000 --> 00:00:01,400"));
  expect(screen.getByTestId("download")).toHaveAttribute("href", "/api/lectures/1/export/srt?script=spoken&kind=all&show=CORRECT&show=NOT_SURE&show=NONE");
  await userEvent.selectOptions(screen.getByRole("combobox", { name: "أقواس الآيات" }), "« … »");
  await waitFor(() => expect(calls.some((c) => c.method === "PATCH" && c.path === "/api/export/style")).toBe(true));
  expect(calls.find((c) => c.method === "PATCH")!.body).toEqual({ quranBracketOpen: "«", quranBracketClose: "»" });
});
