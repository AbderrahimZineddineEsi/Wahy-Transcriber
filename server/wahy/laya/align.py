"""ASR tokens <-> ground-truth tokens: unique 4-gram anchors chained by LIS, Levenshtein inside the gaps."""
from __future__ import annotations

from bisect import bisect_left
from dataclasses import dataclass
from typing import Dict, List, Tuple

from rapidfuzz.distance import Levenshtein
from rapidfuzz.fuzz import ratio

ANCHOR_N = 4
FUZZY = 70.0        # token similarity (0-100) accepted for a substitution
MAX_GAP = 1500


@dataclass
class Alignment:
    asr2gt: List[int]            # gt index per asr token, -1 = unaligned
    gt2asr: List[int]
    exact: List[bool]            # asr token equals its gt token
    first_anchor: Tuple[int, int] = (0, 0)     # (asr, gt) of the first/last anchors
    last_anchor: Tuple[int, int] = (0, 0)
    n_anchors: int = 0

    def coverage(self) -> Tuple[float, float]:
        """Aligned share of the asr tokens / gt tokens inside the anchored region."""
        a0, g0 = self.first_anchor
        a1, g1 = self.last_anchor
        if self.n_anchors == 0:
            return 0.0, 0.0
        na = sum(1 for x in self.asr2gt[a0:a1 + 1] if x >= 0)
        ng = sum(1 for x in self.gt2asr[g0:g1 + 1] if x >= 0)
        return na / max(1, a1 - a0 + 1), ng / max(1, g1 - g0 + 1)

    def quality(self, lo: int, hi: int) -> float:
        """Aligned share of asr tokens [lo, hi)."""
        lo, hi = max(0, lo), min(len(self.asr2gt), hi)
        return sum(1 for x in self.asr2gt[lo:hi] if x >= 0) / max(1, hi - lo)


def _anchors(a: List[str], g: List[str]) -> List[Tuple[int, int]]:
    def grams(seq: List[str]) -> Dict[Tuple[str, ...], List[int]]:
        d: Dict[Tuple[str, ...], List[int]] = {}
        for i in range(len(seq) - ANCHOR_N + 1):
            d.setdefault(tuple(seq[i:i + ANCHOR_N]), []).append(i)
        return d
    ga, gg = grams(a), grams(g)
    pairs = sorted((ia[0], gg[k][0]) for k, ia in ga.items() if len(ia) == 1 and len(gg.get(k, ())) == 1)
    # longest increasing subsequence on the gt index keeps a consistent order
    tails: List[int] = []
    idx: List[int] = []
    prev = [-1] * len(pairs)
    for i, (_, gi) in enumerate(pairs):
        j = bisect_left(tails, gi)
        if j == len(tails):
            tails.append(gi); idx.append(i)
        else:
            tails[j] = gi; idx[j] = i
        prev[i] = idx[j - 1] if j else -1
    out, k = [], idx[-1] if idx else -1
    while k >= 0:
        out.append(pairs[k]); k = prev[k]
    return out[::-1]


def _align_gap(a: List[str], g: List[str], a0: int, g0: int, asr2gt: List[int], exact: List[bool]) -> None:
    if not a or not g or len(a) > MAX_GAP or len(g) > MAX_GAP:
        return
    if max(len(a), len(g)) > 4 * min(len(a), len(g)) + 20:    # mostly one-sided: nothing trustworthy to pair
        return
    for op in Levenshtein.opcodes(a, g):
        if op.tag == "equal":
            for k in range(op.src_end - op.src_start):
                asr2gt[a0 + op.src_start + k] = g0 + op.dest_start + k
                exact[a0 + op.src_start + k] = True
        elif op.tag == "replace" and op.src_end - op.src_start == op.dest_end - op.dest_start:
            for k in range(op.src_end - op.src_start):
                if ratio(a[op.src_start + k], g[op.dest_start + k]) >= FUZZY:
                    asr2gt[a0 + op.src_start + k] = g0 + op.dest_start + k


def align(asr: List[str], gt: List[str]) -> Alignment:
    asr2gt = [-1] * len(asr)
    exact = [False] * len(asr)
    anchors = _anchors(asr, gt)
    ca, cg = 0, 0
    for ia, ig in anchors:
        _align_gap(asr[ca:ia], gt[cg:ig], ca, cg, asr2gt, exact)
        for k in range(ANCHOR_N):
            if asr2gt[ia + k] < 0 or ia + k >= ca:
                asr2gt[ia + k] = ig + k
                exact[ia + k] = True
        ca, cg = max(ca, ia + ANCHOR_N), max(cg, ig + ANCHOR_N)
    _align_gap(asr[ca:], gt[cg:], ca, cg, asr2gt, exact)
    gt2asr = [-1] * len(gt)
    for i, j in enumerate(asr2gt):
        if j >= 0:
            gt2asr[j] = i
    return Alignment(asr2gt, gt2asr, exact,
                     first_anchor=(anchors[0][0], anchors[0][1]) if anchors else (0, 0),
                     last_anchor=(anchors[-1][0] + ANCHOR_N - 1, anchors[-1][1] + ANCHOR_N - 1) if anchors else (0, 0),
                     n_anchors=len(anchors))
