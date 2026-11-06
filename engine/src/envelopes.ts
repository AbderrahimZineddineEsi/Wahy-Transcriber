// envelopes(): the one way to build what Laya (and the prompt-driven verifiers) read for a finding (ADR 0003,
// ROADMAP phase 5). The builders themselves are envelope-builders.js, moved verbatim from the old app.
import { matcherFor } from "./detect.ts";
import * as builders from "./envelope-builders.js";
import type { DetectOptions, Finding, Word } from "./types.ts";

// the builders are the old untyped code; TypeScript would read their `= null` defaults as types
const {
  boundaryByRule, buildCanonicalDecisionEnvelope, buildLayaV2Requests, buildLayaV3Requests, buildPassageEnvelope,
  groupLayaPassages,
}: Record<string, any> = builders;

/** 1: the canonical envelope (Laya run 1-2 checkpoints, Gemini, JEV, OpenRouter chat). 2: Laya v2 (laya_v2
 *  checkpoints). 3: Laya v3 (run 6: corpus text first, no neighbours). A checkpoint records the version it expects. */
export type EnvelopeVersion = 1 | 2 | 3;

export interface EnvelopeOptions extends DetectOptions {
  /** One envelope per passage (consecutive verses found back to back) instead of per finding.
   *  Default: true for v2 and v3 (as the Laya checkpoints were trained), false for v1. */
  passages?: boolean;
  /** v2 only: list the nearest other findings, without verdicts. Default false. */
  neighbours?: boolean;
  /** Indices into `findings` of the findings to verify (default: all). Passages and neighbours are still found among
   *  all the findings, so pass every finding of the lecture, not only the targets. */
  targets?: number[] | null;
  /** v1 only: transcript words on each side in `context_before` / `context_after`. Default 25. */
  contextWords?: number;
}

/** One request: the findings it covers (indices into `findings`) and what the model reads. */
export interface Envelope {
  members: number[];
  state: Record<string, unknown>;
  questions: Record<string, unknown>;
  /** v1 only: the merge question about the finding's close neighbours (prompt-driven verifiers), or null */
  merge?: unknown;
  /** v3 only: the no-model boundary (1 = that side was cut off), for checkpoints not trained on the boundary */
  boundaryByRule?: { start: 0 | 1; end: 0 | 1 };
}

/**
 * Envelopes for a lecture's findings. `findings` are every finding of one engine run on `words` (as detect() returns
 * them, or the same fields as plain JSON); the engine options must be the ones that produced them, because the
 * envelope reads the corpus units of that engine.
 */
export function envelopes(findings: Finding[], words: Word[], version: EnvelopeVersion, options: EnvelopeOptions): Envelope[] {
  if (version !== 1 && version !== 2 && version !== 3) throw new Error(`unknown envelope version ${version} (1, 2 or 3)`);
  if (options.neighbours && version !== 2) throw new Error(`the neighbours option is for envelope v2, not v${version}`);
  const n = findings.length;
  for (const t of options.targets ?? []) {
    if (!Number.isInteger(t) || t < 0 || t >= n) throw new Error(`target ${t} is not a finding index (0..${n - 1})`);
  }
  const ctx = { units: matcherFor(options).units, ayat: options.corpus.ayat, detections: findings };
  const targets = options.targets ? options.targets.map((i) => findings[i]) : null;
  const indexOf = (d: Finding) => findings.indexOf(d);

  if (version === 1) {
    const W = options.contextWords ?? 25;
    if (!options.passages) {
      const want = targets ? new Set(targets) : null;
      return findings.flatMap((d, i) => {
        if (want && !want.has(d)) return [];
        const env = buildCanonicalDecisionEnvelope(ctx, d, words, W);
        return [{ members: [i], state: env.state, questions: env.questions, merge: env.merge }];
      });
    }
    // js/ai-verifier.js buildPromptProviderItems with the passages rule on
    const want = new Set(targets ?? findings);
    return groupLayaPassages(findings, true, words)
      .filter((g: Finding[]) => g.some((d) => want.has(d)))
      .map((g: Finding[]) => {
        const env = buildPassageEnvelope(ctx, g, words, W);
        return { members: g.map(indexOf), state: env.state, questions: env.questions, merge: env.merge };
      });
  }

  const builder = version === 2 ? buildLayaV2Requests : buildLayaV3Requests;
  return builder(ctx, findings, words, { passages: options.passages, neighbours: options.neighbours }, targets)
    .map((r: { members: Finding[]; state: Record<string, unknown>; questions: Record<string, unknown> }) => {
      const out: Envelope = { members: r.members.map(indexOf), state: r.state, questions: r.questions };
      if (version === 3) out.boundaryByRule = boundaryByRule(r.state);
      return out;
    });
}

/** The no-model boundary for a v2 or v3 state: a side is cut off (1) when one of its corpus edge words was heard. */
export function ruleBoundary(state: Record<string, unknown>): { start: 0 | 1; end: 0 | 1 } {
  return boundaryByRule(state);
}
