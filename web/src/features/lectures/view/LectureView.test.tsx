import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { fakeServer, json, renderApp, type Call } from "../../../test/render";
import type { LectureDetail } from "../api";
import { row, sampleWords } from "./fixtures";

const now = "2026-11-06T10:00:00";
const lecture: LectureDetail = {
  id: 1, title: "درس الجمعة", source_kind: "text", source_url: null, has_media: false, duration_s: 7, language: "ar",
  transcription_model: null, word_count: sampleWords.length, version_count: 1, created_at: now, updated_at: now, words: sampleWords,
};
const findings = [
  row({}),
  row({ id: 2, idx: 1, source_type: "HADITH", display_ref: "البخاري (1)", word_start: 10, word_end: 12, verdict: { verdict: "FALSE", boundary: "COMPLETE", verifier: "laya", model: "v3_mixed" } }),
];
const version = { id: 7, lecture_id: 1, name: "before re-detect (v4)", created_at: now };

beforeEach(() => window.localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

function server() {
  return fakeServer((call: Call) => {
    if (call.method === "GET" && call.path === "/api/lectures/1") return json(lecture);
    if (call.path === "/api/lectures/1/findings") return json({ lecture_id: 1, count: findings.length, findings });
    if (call.path === "/api/lectures/1/versions" && call.method === "GET") return json([version]);
    if (call.path === "/api/lectures/1/versions/7") return json({ ...version, snapshot: { engine: "v4", findings: [findings[0].data] } });
    if (call.path === "/api/lectures/1/versions" && call.method === "POST") return json({ ...version, id: 8, name: "mine" }, 201);
    if (call.path === "/api/lectures/1/words/5" && call.method === "PATCH") return json({ ...sampleWords[5], text: "اللّه" });
    if (call.path === "/api/jobs") return json([]);
  });
}

const quote = (kind: string) => screen.getByTestId("transcript").querySelector(`.f[data-kind="${kind}"]`);
const word = (i: number) => screen.getByTestId("transcript").querySelector<HTMLElement>(`[data-i="${i}"]`)!;

test("the transcript shows each quote with its brackets and reference, and the counts", async () => {
  server();
  renderApp("/lectures/1");
  const transcript = await screen.findByTestId("transcript");
  expect(transcript).toHaveTextContent("﴿قل هو الله أحد﴾الإخلاص: 1");
  expect(transcript).toHaveTextContent("«إنما الأعمال بالنيات»البخاري (1)");
  expect(quote("hadith")).toHaveClass("bad"); // a false finding is hatched
  expect(screen.getByTestId("count-quran")).toHaveTextContent("1");
  expect(screen.getByTestId("count-hadith")).toHaveTextContent("1");
  expect(screen.getByRole("link", { name: /العرض/ })).toHaveTextContent("2");
});

test("clicking a word moves the marker there and shows its caption", async () => {
  server();
  renderApp("/lectures/1");
  await screen.findByTestId("transcript");
  await userEvent.click(word(4));
  expect(word(4)).toHaveClass("now");
  expect(word(3)).toHaveClass("played");
  expect(word(8)).not.toHaveClass("played");
  expect(screen.getByTestId("caption")).toHaveTextContent("﴿قل هو الله أحد﴾ [الإخلاص: 1]");
  expect(screen.getByTestId("nowcard")).toHaveTextContent("الإخلاص: 1");
  await userEvent.click(word(8));
  expect(word(4)).not.toHaveClass("now");
  expect(word(8)).toHaveClass("now");
  expect(screen.getByTestId("nowcard")).toHaveTextContent("كلام المتحدث");
});

test("a reference opens the quote's card; its edit button opens the editor on that finding", async () => {
  server();
  renderApp("/lectures/1");
  await screen.findByTestId("transcript");
  await userEvent.click(screen.getByRole("button", { name: "البخاري (1)" }));
  const card = screen.getByTestId("finding-card");
  expect(card).toHaveTextContent("كلام عادي");
  expect(card).toHaveTextContent("laya · v3_mixed");
  expect(quote("hadith")).toHaveClass("sel");
  await userEvent.click(within(card).getByRole("link", { name: "تحرير" }));
  const inspector = await screen.findByTestId("inspector"); // the editor, open on that finding
  expect(within(inspector).getByTestId("insp-ref")).toHaveTextContent("البخاري (1)");
});

test("filters: a hidden quote's words stay, as plain speech, in the transcript and the captions", async () => {
  server();
  renderApp("/lectures/1");
  await screen.findByTestId("transcript");
  expect(screen.getByTestId("count-captions")).toHaveTextContent("5");
  await userEvent.click(screen.getByRole("button", { name: "كلام عادي" }));
  expect(quote("hadith")).toBeNull();
  expect(screen.getByTestId("transcript")).toHaveTextContent("إنما الأعمال بالنيات");
  expect(screen.getByTestId("count-captions")).toHaveTextContent("3"); // the speech around it joins up
  await userEvent.click(word(11));
  expect(screen.getByTestId("caption")).not.toHaveTextContent("«");

  await userEvent.click(screen.getByRole("button", { name: "أحاديث" }));
  expect(quote("quran")).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: "الكل" }));
  await userEvent.selectOptions(screen.getByLabelText("عرض سريع"), "all");
  expect(quote("quran")).not.toBeNull();
  expect(quote("hadith")).not.toBeNull();
});

test("standard script shows a quote's source text; search marks matching words", async () => {
  server();
  renderApp("/lectures/1");
  await screen.findByTestId("transcript");
  await userEvent.click(screen.getByLabelText("بالرسم المعتمد"));
  expect(screen.getByTestId("transcript")).toHaveTextContent("﴿قُلْ هُوَ اللَّهُ أَحَدٌ﴾");
  await userEvent.type(screen.getByLabelText("ابحث في المحاضرة"), "قال");
  await waitFor(() => expect(screen.getByTestId("hits")).toHaveTextContent("2"));
  expect(word(0)).toHaveClass("hit");
  expect(word(8)).toHaveClass("hit");
  expect(word(1)).not.toHaveClass("hit");
});

test("double-clicking a word corrects it in place", async () => {
  const calls = server();
  renderApp("/lectures/1");
  await screen.findByTestId("transcript");
  await userEvent.dblClick(word(5));
  const input = within(screen.getByTestId("word-editor")).getByRole("textbox");
  await userEvent.clear(input);
  await userEvent.type(input, "اللّه{Enter}");
  await waitFor(() => expect(word(5)).toHaveTextContent("اللّه"));
  expect(calls.find((c) => c.method === "PATCH")).toMatchObject({ path: "/api/lectures/1/words/5", body: { text: "اللّه" } });
});

test("a saved version shows its own findings, read only; the current ones can be saved as a version", async () => {
  const calls = server();
  renderApp("/lectures/1");
  await screen.findByTestId("transcript");
  await userEvent.selectOptions(screen.getByLabelText("النسخة"), "7");
  expect(await screen.findByText(/تعرض نسخة محفوظة «before re-detect \(v4\)»/)).toBeInTheDocument();
  await waitFor(() => expect(quote("hadith")).toBeNull());
  expect(quote("quran")).not.toBeNull();
  await userEvent.click(screen.getByRole("button", { name: "العودة إلى الحالية" }));
  await waitFor(() => expect(quote("hadith")).not.toBeNull());

  await userEvent.click(screen.getByRole("button", { name: "حفظ نسخة" }));
  await userEvent.type(screen.getByLabelText("اسم النسخة"), "mine{Enter}");
  await waitFor(() => expect(calls.find((c) => c.method === "POST" && c.path.endsWith("/versions"))).toBeDefined());
  const saved = calls.find((c) => c.method === "POST")!.body as { name: string; snapshot: { findings: unknown[]; verdicts: unknown[] } };
  expect(saved.name).toBe("mine");
  expect(saved.snapshot.findings).toHaveLength(2);
  expect(saved.snapshot.verdicts[1]).toMatchObject({ verdict: "FALSE" });
});

test("layout: text only hides the player", async () => {
  server();
  renderApp("/lectures/1");
  await screen.findByTestId("transcript");
  await userEvent.click(screen.getByRole("button", { name: "النص فقط" }));
  expect(document.querySelector(".stage")).toHaveAttribute("data-layout", "text");
  expect(window.localStorage.getItem("wahy.view.layout")).toBe("text");
});

test("on a long lecture, the paragraphs before the spoken word are marked done, and a jump back clears them", async () => {
  const long = Array.from({ length: 140 }, (_, i) => ({ idx: i, text: i % 45 === 44 ? "نهاية." : `كلمة${i}`, start: i * 0.5, end: i * 0.5 + 0.4 }));
  fakeServer((call: Call) => {
    if (call.method === "GET" && call.path === "/api/lectures/1") return json({ ...lecture, words: long, duration_s: 70 });
    if (call.path === "/api/lectures/1/findings") return json({ lecture_id: 1, count: 0, findings: [] });
    if (call.path === "/api/lectures/1/versions") return json([]);
    if (call.path === "/api/jobs") return json([]);
  });
  renderApp("/lectures/1");
  await screen.findByTestId("transcript");
  const paras = () => Array.from(screen.getByTestId("transcript").querySelectorAll("p"));
  expect(paras().map((p) => p.dataset.first)).toEqual(["0", "45", "90", "135"]);

  await userEvent.click(word(95));
  expect(paras().map((p) => p.classList.contains("done"))).toEqual([true, true, false, false]);
  expect(word(93)).toHaveClass("played");
  expect(word(96)).not.toHaveClass("played");
  expect(word(95)).toHaveClass("now");

  await userEvent.click(word(10));
  expect(paras().some((p) => p.classList.contains("done"))).toBe(false);
  expect(word(93)).not.toHaveClass("played");
  expect(word(5)).toHaveClass("played");
  expect(word(10)).toHaveClass("now");
  expect(word(95)).not.toHaveClass("now");
});

test("the rail shows the open lecture as a place, even on the first visit", async () => {
  server();
  renderApp("/lectures/1");
  await screen.findByTestId("transcript");
  expect(screen.getByRole("link", { name: "المحاضرة المفتوحة" })).toHaveAttribute("href", "/lectures/1");
});
