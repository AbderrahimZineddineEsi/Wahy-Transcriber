// Laya training rows (ROADMAP phase 20, F-101): a verdict on a finding, written as one Laya JSONL row
// {id, state, questions, answers, meta}. Moved from the old app's js/ai-verifier.js
// (convertRecordToLayaTrainingEnvelope, convertVerificationRecordsToLayaJsonl) with the same output byte for byte
// (engine/golden/expected/laya_export.jsonl, training.test.ts). The envelope itself is not built here: the caller
// passes the v1 envelope that envelopes() built (ADR 0003: one envelope builder).
//
// What changed from the old code: no globals. The clock, the random id suffix and the lecture title are arguments,
// and a record may say its own id, time and lecture title (the server's labels come from many lectures). A row can
// also carry the two additions the old app never wrote because its "approve all" and "delete as ordinary speech"
// were broken: `human_gold_resolution` (the old "approve all" record shape) and `meta.ref_issue` (N-007).

/** A verifier's (or the user's) answer about one finding, as the old app kept it on `det.aiVerification`. */
export interface VerdictInfo {
  verdict?: string;
  confidence?: number;
  probabilities?: Record<string, number> | null;
  boundaryStatus?: string;
  boundaryConfidence?: number;
  boundaryProbabilities?: Record<string, number> | null;
  requestId?: string;
  modelUsed?: string;
  provider?: string;
  /** the user's verdict: a gold label (probabilities 0.98 / 0.01 / 0.01, `meta.human_verified`) */
  humanOverride?: boolean;
}

/** One Laya JSONL row. */
export interface LayaRow {
  id: string;
  state: unknown;
  questions: unknown;
  answers: {
    verdict: { type: "choice"; choice: string; probabilities: Record<string, number> };
    boundary_status: { type: "choice"; choice: string; probabilities: Record<string, number> };
  };
  meta: { source_provider: string; human_verified: boolean; lecture_title: string; converted_at: number; ref_issue?: true };
  human_gold_resolution?: { verdict: string; user_action: string; timestamp: string };
}

/** What a row is made from: a finding's verdict and its v1 envelope (`{state, questions}`). */
export interface TrainingRecord {
  aiVerification?: VerdictInfo | null;
  envelope: { state: unknown; questions: unknown } | null;
  /** fixed id (else the request id, else `wahy_dec_<time>_<random>` as the old app made it) */
  id?: string;
  /** fixed `converted_at` in seconds (else the export's time plus the record's position, as the old export did) */
  convertedAt?: number;
  lectureTitle?: string;
  /** N-007: the user said the reference is wrong or incomplete */
  refIssue?: boolean;
  /** the old "approve all" record's extra key */
  humanGoldResolution?: { verdict: string; user_action: string; timestamp: string };
}

export interface ConvertContext {
  /** the lecture title when a record has none (the old app's open lecture) */
  lectureTitle?: string;
  /** Math.random by default; tests pass a seeded one */
  random?: () => number;
}

export interface JsonlStats {
  total_input: number;
  total_converted: number;
  by_verdict: { CORRECT: number; FALSE: number; NOT_SURE: number };
  human_verified_count: number;
  ai_count: number;
}

/** js/ai-verifier.js convertRecordToLayaTrainingEnvelope, unchanged apart from the arguments. */
export function layaRow(det: { aiVerification?: VerdictInfo | null }, env: { state: unknown; questions: unknown }, timestamp: number, ctx: ConvertContext = {}): LayaRow {
  const random = ctx.random ?? Math.random;
  const ts = timestamp || Math.floor(Date.now() / 1000);
  const ai = det.aiVerification ?? undefined;
  const recId = ai?.requestId || `wahy_dec_${ts}_${Math.floor(random() * 10000)}`;

  const rawVerdict = (ai?.verdict || "CORRECT").toUpperCase();
  const isHuman = Boolean(ai?.humanOverride);
  const conf = typeof ai?.confidence === "number" ? ai.confidence : 0.88;

  let probs = ai?.probabilities ?? undefined;
  if (isHuman) {
    probs = { CORRECT: 0.01, FALSE: 0.01, NOT_SURE: 0.01 };
    probs[rawVerdict] = 0.98;
  } else if (!probs) {
    const rem = parseFloat(((1.0 - conf) / 2.0).toFixed(4));
    probs = {
      CORRECT: rawVerdict === "CORRECT" ? conf : rem,
      FALSE: rawVerdict === "FALSE" ? conf : rem,
      NOT_SURE: rawVerdict === "NOT_SURE" ? conf : rem,
    };
  }

  const bStatus = ai?.boundaryStatus || "COMPLETE_SPAN";
  const bConf = typeof ai?.boundaryConfidence === "number" ? ai.boundaryConfidence : 0.95;
  let bProbs = ai?.boundaryProbabilities ?? undefined;
  if (!bProbs) {
    const remB = parseFloat(((1.0 - bConf) / 3.0).toFixed(4));
    bProbs = {
      COMPLETE_SPAN: bStatus === "COMPLETE_SPAN" ? bConf : remB,
      MISSING_START: bStatus === "MISSING_START" ? bConf : remB,
      MISSING_END: bStatus === "MISSING_END" ? bConf : remB,
      MISSING_BOTH: bStatus === "MISSING_BOTH" ? bConf : remB,
    };
  }

  return {
    id: recId,
    state: env.state,
    questions: env.questions,
    answers: {
      verdict: { type: "choice", choice: rawVerdict, probabilities: probs },
      boundary_status: { type: "choice", choice: bStatus, probabilities: bProbs },
    },
    meta: {
      source_provider: ai?.modelUsed || ai?.provider || "gemini-3.5-flash-lite",
      human_verified: isHuman,
      lecture_title: ctx.lectureTitle || "Wahy Islamic Lecture",
      converted_at: ts,
    },
  };
}

/** A stored row is passed through as it is (the old bank kept rows already converted). */
function isRow(rec: unknown): rec is LayaRow {
  const r = rec as Record<string, unknown> | null;
  return Boolean(r && r.state && r.questions && r.answers);
}

/**
 * js/ai-verifier.js convertVerificationRecordsToLayaJsonl: stored rows go out unchanged, other records are converted
 * with `now + position` as their time (as the old export did). `now` is in seconds.
 */
export function layaJsonl(records: Array<TrainingRecord | LayaRow>, now: number, ctx: ConvertContext = {}): { jsonl: string; stats: JsonlStats } {
  const lines: string[] = [];
  const stats: JsonlStats = {
    total_input: records.length,
    total_converted: 0,
    by_verdict: { CORRECT: 0, FALSE: 0, NOT_SURE: 0 },
    human_verified_count: 0,
    ai_count: 0,
  };
  const count = (row: LayaRow) => {
    stats.total_converted++;
    const v = row.answers?.verdict?.choice || "CORRECT";
    if (v in stats.by_verdict) stats.by_verdict[v as keyof JsonlStats["by_verdict"]]++;
    if (row.meta?.human_verified) stats.human_verified_count++;
    else stats.ai_count++;
  };

  records.forEach((rec, idx) => {
    if (!rec) return;
    if (isRow(rec)) {
      lines.push(JSON.stringify(rec));
      count(rec);
      return;
    }
    if (!rec.envelope) throw new Error(`training record ${idx} has no envelope`);
    const row = layaRow(rec, rec.envelope, rec.convertedAt ?? now + idx, { ...ctx, lectureTitle: rec.lectureTitle ?? ctx.lectureTitle });
    if (rec.id) row.id = rec.id;
    if (rec.refIssue) row.meta.ref_issue = true;
    if (rec.humanGoldResolution) row.human_gold_resolution = rec.humanGoldResolution;
    lines.push(JSON.stringify(row));
    count(row);
  });

  return { jsonl: lines.join("\n") + (lines.length ? "\n" : ""), stats };
}
