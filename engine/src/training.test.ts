// The Laya JSONL export (ROADMAP phase 20, F-101): the port must write exactly the old app's file for the same
// records (engine/golden/expected/laya_export.jsonl, made by make_golden.mjs layaExport()). No corpus needed: the
// v1 envelopes of the sample's v5 findings are golden files too.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { layaJsonl, layaRow } from "./training.ts";
import type { TrainingRecord, VerdictInfo } from "./training.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const EXPECTED = path.join(ROOT, "engine/golden/expected");
const manifest = JSON.parse(fs.readFileSync(path.join(EXPECTED, "manifest.json"), "utf8"));
const NOW = Math.floor(manifest.fixed_now_ms / 1000);
const TITLE = "محاضرة تجريبية — آيات وأحاديث وأذكار";

/** make_golden.mjs's seeded Math.random */
function seeded() {
  let seed = 1;
  return () => (seed = (seed * 48271) % 2147483647) / 2147483647;
}

const envs: Array<{ state: unknown; questions: unknown }> = JSON.parse(
  fs.readFileSync(path.join(EXPECTED, "sample/v5/envelopes.v1.json"), "utf8"),
);

/** what setHumanOverrideVerdict put on the finding */
function human(verdict: string): VerdictInfo {
  const p = { CORRECT: 0.01, FALSE: 0.01, NOT_SURE: 0.01, [verdict]: 0.98 };
  return { verdict, confidence: 0.98, humanOverride: true, probabilities: p };
}

const AI: VerdictInfo[] = [
  { verdict: "CORRECT", confidence: 0.91, probabilities: { CORRECT: 0.91, FALSE: 0.06, NOT_SURE: 0.03 },
    boundaryStatus: "MISSING_END", boundaryConfidence: 0.8,
    boundaryProbabilities: { COMPLETE_SPAN: 0.1, MISSING_START: 0.05, MISSING_END: 0.8, MISSING_BOTH: 0.05 },
    requestId: "req_golden_1", modelUsed: "gemini-3.5-flash-lite", provider: "gemini" },
  { verdict: "FALSE", confidence: 0.7, requestId: "req_golden_2", provider: "openrouter_chat" },
  {},
];

describe("Laya JSONL export", () => {
  test("the golden records give the old app's file byte for byte", () => {
    const random = seeded();
    // the three user verdicts were stored already converted, at the time they were given
    const stored = ["CORRECT", "FALSE", "NOT_SURE"].map((v, i) =>
      layaRow({ aiVerification: human(v) }, envs[i], NOW, { lectureTitle: TITLE, random }));
    // the three AI verdicts are converted by the export
    const records: Array<TrainingRecord | ReturnType<typeof layaRow>> = [
      ...stored,
      ...AI.map((ai, i) => ({ aiVerification: ai, envelope: envs[3 + i] })),
    ];
    const { jsonl, stats } = layaJsonl(records, NOW, { lectureTitle: TITLE, random });
    expect(jsonl).toBe(fs.readFileSync(path.join(EXPECTED, "laya_export.jsonl"), "utf8"));
    expect(stats).toEqual({ total_input: 6, total_converted: 6, by_verdict: { CORRECT: 3, FALSE: 2, NOT_SURE: 1 },
      human_verified_count: 3, ai_count: 3 });
  });

  test("stored rows pass through unchanged, so an imported bank exports as it was", () => {
    const golden = fs.readFileSync(path.join(EXPECTED, "laya_export.jsonl"), "utf8");
    const rows = golden.trim().split("\n").map((l) => JSON.parse(l));
    expect(layaJsonl(rows, 0).jsonl).toBe(golden);
  });

  test("a record's own id, time, title, reference flag and approve-all resolution", () => {
    const resolution = { verdict: "CORRECT", user_action: "VALIDATE_ALL", timestamp: "2026-11-07T10:00:00.000Z" };
    const { jsonl } = layaJsonl([
      { aiVerification: human("CORRECT"), envelope: envs[0], id: "wahy_label_7", convertedAt: 1700000000,
        lectureTitle: "درس", refIssue: true, humanGoldResolution: resolution },
    ], NOW);
    const row = JSON.parse(jsonl);
    expect(row.id).toBe("wahy_label_7");
    expect(row.meta).toEqual({ source_provider: "gemini-3.5-flash-lite", human_verified: true, lecture_title: "درس",
      converted_at: 1700000000, ref_issue: true });
    expect(row.human_gold_resolution).toEqual(resolution);
    expect(Object.keys(row)).toEqual(["id", "state", "questions", "answers", "meta", "human_gold_resolution"]);
  });

  test("defaults: no title gives the old placeholder, an empty list gives an empty file", () => {
    const row = JSON.parse(layaJsonl([{ aiVerification: { verdict: "FALSE", confidence: 1 }, envelope: envs[0] }], 5).jsonl);
    expect(row.meta.lecture_title).toBe("Wahy Islamic Lecture");
    expect(row.meta.converted_at).toBe(5);
    expect(row.answers.verdict.probabilities).toEqual({ CORRECT: 0, FALSE: 1, NOT_SURE: 0 });
    expect(layaJsonl([], 5).jsonl).toBe("");
    expect(() => layaJsonl([{ envelope: null }], 5)).toThrow(/no envelope/);
  });
});
