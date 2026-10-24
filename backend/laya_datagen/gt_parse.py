"""Ground-truth transcript -> normalised tokens + located quotes.

Quran quotes are anchored by the `[سورة: آية]` refs Bin Baz prints after each verse; the verse words are found in the
tokens just before the ref, so the span is exact and tells us which words of the ayah the speaker actually said.
Hadith are located only where the book text is followed by a takhrij line (رواه ...); everything else is GT-silent.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from difflib import SequenceMatcher
from typing import Callable, Dict, List, Optional, Tuple

NormWords = Callable[[List[str]], List[List[str]]]      # words -> per-word list of engine-normalised tokens
UnitNorms = Callable[[List[str]], Dict[str, List[str]]]  # ["2:255"] -> normalised ayah words

REF_RE = re.compile(r"\[\s*((?:سورة\s+)?[ء-يً-ْ ]{2,30}?)\s*[:：]\s*([0-9٠-٩]+)(?:\s*[-–—]\s*([0-9٠-٩]+))?\s*\]")
TASHKEEL_RE = re.compile(r"[ً-ْٰ]")
TAKHRIJ_RE = re.compile(r"^(?:و?رواه|و?أخرجه|متفق عليه|و?اخرجه)")
NARRATOR_LINE_RE = re.compile(r"^\d+\s*/\s*\d+")


def _digits(s: str) -> int:
    return int(s.translate(str.maketrans("٠١٢٣٤٥٦٧٨٩", "0123456789")))


@dataclass
class QuranSpan:
    unit_id: str
    gt_start: int          # token range in GT token space, end exclusive
    gt_end: int
    u_start: int           # which words of the ayah the speaker said (end exclusive)
    u_end: int
    u_len: int
    matched: int


@dataclass
class HadithRegion:
    gt_start: int
    gt_end: int


@dataclass
class GTDoc:
    tokens: List[str] = field(default_factory=list)
    roles: List[str] = field(default_factory=list)        # "book" | "sheikh" per token
    tashkeel: List[bool] = field(default_factory=list)    # token came from a (strongly) diacritised word
    words: List[str] = field(default_factory=list)        # original written words, for display
    tok_word: List[int] = field(default_factory=list)     # token -> index in `words`
    quran: List[QuranSpan] = field(default_factory=list)
    hadith: List[HadithRegion] = field(default_factory=list)
    unresolved_refs: List[str] = field(default_factory=list)


def surah_lookup(names: Dict[str, str], norm_words: NormWords) -> Dict[str, int]:
    def key(name: str) -> str:
        name = re.sub(r"^سورة\s+", "", name.strip())
        return "".join("".join(t) for t in norm_words(name.split()))
    return {key(n): int(k) for k, n in names.items()}


def locate_ayah(window: List[str], u: List[str]) -> Optional[Tuple[int, int, int, int, int]]:
    """Densest monotone cluster of exact word matches of ayah `u` inside `window`.

    Returns (w_start, w_end, u_start, u_end, matched) or None.
    """
    if not window or not u:
        return None
    blocks = [b for b in SequenceMatcher(None, window, u, autojunk=False).get_matching_blocks() if b.size]
    best, cur = None, []
    for b in blocks:
        if cur and b.a - (cur[-1].a + cur[-1].size) > 3:       # a gap of >3 window words ends the cluster
            if best is None or sum(x.size for x in cur) > sum(x.size for x in best):
                best = cur
            cur = []
        cur.append(b)
    if cur and (best is None or sum(x.size for x in cur) > sum(x.size for x in best)):
        best = cur
    if not best:
        return None
    matched = sum(x.size for x in best)
    if matched < 3 and matched < 0.6 * len(u):
        return None
    return best[0].a, best[-1].a + best[-1].size, best[0].b, best[-1].b + best[-1].size, matched


TAKHRIJ_WORDS = {"رواه", "ورواه", "متفق", "أخرجه", "وأخرجه", "اخرجه"}


def _inline_hadith(doc: GTDoc, bw: List[Tuple[str, int]]) -> None:
    """A numbered hadith paragraph: narrator intro ... `يقول:` MATN `رواه X.` -> region = the matn tokens."""
    # intros can hold two colons («قال: سمعت رسول الله ﷺ يقول: …»): the matn starts after the last one in the first 24 words
    colons = [j for j, (w, _) in enumerate(bw[:24]) if j >= 1 and w.rstrip().endswith(":")]
    intro = colons[-1] if colons else None
    if intro is None or intro + 1 >= len(bw):
        return
    end = next((j for j in range(len(bw) - 1, intro, -1) if bw[j][0].strip("،.") in TAKHRIJ_WORDS), len(bw))
    start_tok = bw[intro + 1][1]
    end_tok = bw[end][1] if end < len(bw) else len(doc.tokens)
    if end_tok - start_tok >= 6:
        doc.hadith.append(HadithRegion(start_tok, end_tok))


def parse_gt(blocks: List[Tuple[str, str]], norm_words: NormWords, names: Dict[str, str], unit_norms: UnitNorms) -> GTDoc:
    """`blocks` = [(kind, text)] in page order, kind in {"book", "sheikh"}."""
    doc = GTDoc()
    lookup = surah_lookup(names, norm_words)
    pending: List[Tuple[int, List[Tuple[int, int, int]]]] = []   # (block_token_base, [(surah, a_from, a_to)])

    def add_words(words: List[str], role: str) -> List[Tuple[str, int]]:
        """Appends the tokens of `words`; returns (plain word, index of its first token) for each."""
        starts: List[Tuple[str, int]] = []
        for w, toks in zip(words, norm_words(words)):
            strong = len(TASHKEEL_RE.findall(w)) >= 2
            starts.append((TASHKEEL_RE.sub("", w), len(doc.tokens)))
            doc.words.append(w)
            for t in toks:
                doc.tok_word.append(len(doc.words) - 1)
                doc.tokens.append(t)
                doc.roles.append(role)
                doc.tashkeel.append(strong)
        return starts

    block_spans: List[Tuple[str, int, int, str]] = []            # kind, tok_start, tok_end, plain text
    refs: List[Tuple[int, int, int, int]] = []                   # (token_pos_at_ref, surah, a_from, a_to) per block order

    for kind, text in blocks:
        b0 = len(doc.tokens)
        pos = 0
        bw: List[Tuple[str, int]] = []
        for m in REF_RE.finditer(text):
            bw += add_words(text[pos:m.start()].split(), kind)
            name = re.sub(r"^سورة\s+", "", m.group(1).strip())
            nk = "".join("".join(t) for t in norm_words(name.split()))
            surah = lookup.get(nk)
            a1 = _digits(m.group(2))
            a2 = _digits(m.group(3)) if m.group(3) else a1
            if surah is None:
                doc.unresolved_refs.append(m.group(0))           # e.g. a hadith ref like [صحيح البخاري: 1]
            elif 0 < a1 <= a2 and a2 - a1 < 60:
                refs.append((len(doc.tokens), surah, a1, a2, b0))
            pos = m.end()
        bw += add_words(text[pos:].split(), kind)
        if kind == "book" and NARRATOR_LINE_RE.match(text.strip()):
            _inline_hadith(doc, bw)
        block_spans.append((kind, b0, len(doc.tokens), re.sub(r"[ً-ْٰ]", "", text)))

    need = sorted({f"{s}:{a}" for _, s, a1, a2, _ in refs for a in range(a1, a2 + 1)})
    norms = unit_norms(need) if need else {}
    for ref_pos, surah, a1, a2, b0 in refs:
        # verses are consecutive: look for each one after the previous one ended, inside the tokens before the ref
        total = sum(len(norms.get(f"{surah}:{a}", [])) for a in range(a1, a2 + 1))
        lo = max(b0, ref_pos - total - 25)
        cursor = lo
        for a in range(a1, a2 + 1):
            uid = f"{surah}:{a}"
            u = norms.get(uid)
            if not u:
                continue
            hit = locate_ayah(doc.tokens[cursor:ref_pos], u)
            if hit is None:
                continue
            ws, we, us, ue, matched = hit
            doc.quran.append(QuranSpan(uid, cursor + ws, cursor + we, us, ue, len(u), matched))
            cursor += we

    for i, (kind, s, e, plain) in enumerate(block_spans):
        if kind == "book" and TAKHRIJ_RE.match(plain.strip()) and i > 0:
            pk, ps, pe, ptext = block_spans[i - 1]
            if pk == "book" and pe - ps >= 6 and not NARRATOR_LINE_RE.match(ptext.strip()):
                doc.hadith.append(HadithRegion(ps, pe))
    return doc
