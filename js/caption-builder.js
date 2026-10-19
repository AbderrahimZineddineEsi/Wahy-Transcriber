// =============================================================================
// Wahy-Finder v2.0 — Module 5 Step 2: Smart Citation-Aware Caption Builder
// File: js/caption-builder.js
// =============================================================================
// Rules implemented:
// 1. Normal Speech (Non-Citation): Group consecutive words into captions up to
//    12 words or 5.0 seconds max, breaking naturally at pauses (gap > 0.4s).
// 2. Pre-Citation Flush: As soon as a word marks the start of a detected Ayah,
//    Hadith, or Dhikr, immediately close the current normal-speech caption so
//    the sacred text starts cleanly at the beginning of a new caption block.
// 3. Atomic Citation Rule (No Mid-Cut):
//    - If the detected Ayah/Hadith/Dhikr is <= 22 words (or <= 9.0 seconds),
//      keep the entire citation in a single unified caption block, even if the
//      speaker pauses in the middle. Append the reference badge (e.g. [البقرة: 255]).
//    - If it is a long Ayah or Hadith (> 22 words and > 9.0s) that cannot fit on
//      screen at once, split it ONLY at internal pause boundaries (gap > 0.35s)
//      or Waqf/punctuation marks into balanced chunks of 12–18 words — never
//      stranding 1 or 2 words at the end of a line.
// 4. Post-Citation Flush: Once the Ayah/Hadith/Dhikr ends, close that caption
//    block immediately so normal commentary resumes in a fresh block.
// =============================================================================

const WAQF_OR_PUNCT_RE = /[،؛:.؟!۝ۖۗۚۛۜ]/;

function formatSecondsToTimestamp(sec, separator = ".") {
  const s = Math.max(0, Number(sec) || 0);
  const hours = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = Math.floor(s % 60);
  const ms = Math.round((s - Math.floor(s)) * 1000);
  const hh = String(hours).padStart(2, "0");
  const mm = String(mins).padStart(2, "0");
  const ss = String(secs).padStart(2, "0");
  const mmm = String(ms).padStart(3, "0");
  return `${hh}:${mm}:${ss}${separator}${mmm}`;
}

function formatSecondsToShortTime(sec) {
  const s = Math.max(0, Number(sec) || 0);
  const mins = Math.floor(s / 60);
  const secs = Math.floor(s % 60);
  const hundredths = Math.floor((s - Math.floor(s)) * 100);
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}.${String(hundredths).padStart(2, "0")}`;
}

function getBracketsForCategory(type, prefs = null) {
  const p = prefs || (typeof getOutputDisplayPrefs === "function" ? getOutputDisplayPrefs() : {});
  if (type === "ayah" || type === "QURAN") {
    return {
      open: p.quranBracketOpen !== undefined ? p.quranBracketOpen : "﴿",
      close: p.quranBracketClose !== undefined ? p.quranBracketClose : "﴾"
    };
  }
  if (type === "hadith" || type === "HADITH") {
    return {
      open: p.hadithBracketOpen !== undefined ? p.hadithBracketOpen : "«",
      close: p.hadithBracketClose !== undefined ? p.hadithBracketClose : "»"
    };
  }
  if (type === "dhikr" || type === "ADHKAR") {
    return {
      open: p.adhkarBracketOpen !== undefined ? p.adhkarBracketOpen : "〖",
      close: p.adhkarBracketClose !== undefined ? p.adhkarBracketClose : "〗"
    };
  }
  return { open: "", close: "" };
}

/**
 * Split a long citation (> 22 words) into balanced chunks of 12-18 words at internal
 * pause boundaries (gap > 0.35s) or Waqf/punctuation marks, never stranding 1-3 words.
 */
function splitLongCitationWords(citationWords) {
  const n = citationWords.length;
  if (n <= 22) return [citationWords];

  const chunks = [];
  let start = 0;

  while (start < n) {
    const remaining = n - start;
    if (remaining <= 20) {
      chunks.push(citationWords.slice(start, n));
      break;
    }

    // Ideal window is 12..18 words, but ensure at least 6 words remain for the next chunk
    const minEnd = Math.min(n - 5, start + 12);
    const maxEnd = Math.min(n - 5, start + 18);

    let bestCut = -1;
    let bestScore = -1;

    for (let i = minEnd; i <= maxEnd; i++) {
      const currW = citationWords[i - 1];
      const nextW = citationWords[i];
      const gap = nextW ? (nextW.start - currW.end) : 0;
      const hasPunct = WAQF_OR_PUNCT_RE.test(currW.word);

      let score = 0;
      if (gap > 0.35) score += 5 + gap * 4;
      if (hasPunct) score += 6;
      // Prefer balanced center (~15 words)
      score -= Math.abs((i - start) - 15) * 0.25;

      if (score > bestScore) {
        bestScore = score;
        bestCut = i;
      }
    }

    if (bestCut === -1) {
      bestCut = Math.min(n - 6, start + 15);
    }

    chunks.push(citationWords.slice(start, bestCut));
    start = bestCut;
  }

  // Final safety check: never strand 1-3 words at the end
  if (chunks.length >= 2 && chunks[chunks.length - 1].length < 4) {
    const tail = chunks.pop();
    const prev = chunks.pop();
    const combined = prev.concat(tail);
    if (combined.length <= 22) {
      chunks.push(combined);
    } else {
      const half = Math.ceil(combined.length / 2);
      chunks.push(combined.slice(0, half), combined.slice(half));
    }
  }

  return chunks;
}

/**
 * Build smart citation-aware captions from word-level timestamps and engine detections.
 */
function buildSmartCaptions(words, detections, prefs = null) {
  if (!Array.isArray(words) || !words.length) return [];

  const visFilter = (typeof currentState === "object" && currentState.aiVerification && currentState.aiVerification.visibilityFilter)
    ? currentState.aiVerification.visibilityFilter
    : { showCorrect: true, showNotSure: true, showFalse: false, showUnverified: true };

  const isFindingVisible = (d) => {
    if (!d) return false;
    const v = d.aiVerification?.verdict;
    if (v === "CORRECT") return visFilter.showCorrect !== false;
    if (v === "NOT_SURE") return visFilter.showNotSure !== false;
    if (v === "FALSE") return Boolean(visFilter.showFalse);
    return visFilter.showUnverified !== false;
  };

  // Map word indices to findings (respecting visibility filter)
  const sortedFindings = (Array.isArray(detections) ? detections : [])
    .slice()
    .filter(d => typeof d.wordStartIdx === "number" && typeof d.wordEndIdx === "number" && isFindingVisible(d))
    .sort((a, b) => a.wordStartIdx - b.wordStartIdx);

  const findingByStartWord = new Map();
  const wordOccupiedByFinding = new Map();

  sortedFindings.forEach((f, fIdx) => {
    if (!findingByStartWord.has(f.wordStartIdx)) {
      findingByStartWord.set(f.wordStartIdx, { finding: f, findingIdx: fIdx });
      for (let wIdx = f.wordStartIdx; wIdx <= f.wordEndIdx; wIdx++) {
        wordOccupiedByFinding.set(wIdx, { finding: f, findingIdx: fIdx });
      }
    }
  });

  const captions = [];
  let normalBuffer = [];

  function flushNormalBuffer() {
    if (!normalBuffer.length) return;
    const firstW = normalBuffer[0];
    const lastW = normalBuffer[normalBuffer.length - 1];
    const rawText = normalBuffer.map(w => w.word).join(" ");
    captions.push({
      id: `cap_${captions.length + 1}`,
      index: captions.length + 1,
      start: Number(firstW.start.toFixed(2)),
      end: Number(lastW.end.toFixed(2)),
      text: rawText,
      displayText: rawText,
      type: "normal",
      findingId: null,
      findingIdx: -1,
      reference: "",
      wordIds: normalBuffer.map(w => w.id),
      wordStartIdx: firstW.id,
      wordEndIdx: lastW.id,
      isAtomicCitation: false
    });
    normalBuffer = [];
  }

  let i = 0;
  const totalWords = words.length;

  while (i < totalWords) {
    // Rule 2: Pre-Citation Flush when a word starts a detected Ayah, Hadith, or Dhikr
    if (findingByStartWord.has(i)) {
      flushNormalBuffer();

      const { finding, findingIdx } = findingByStartWord.get(i);
      const endIdx = Math.min(totalWords - 1, Math.max(i, finding.wordEndIdx));
      const citationWords = words.slice(i, endIdx + 1);
      const wordCount = citationWords.length;
      const duration = citationWords.length
        ? (citationWords[citationWords.length - 1].end - citationWords[0].start)
        : 0;

      const fType = finding.type || (finding.sourceType === "QURAN" ? "ayah" : (finding.sourceType === "ADHKAR" ? "dhikr" : "hadith"));
      const brackets = getBracketsForCategory(fType, prefs);
      const refBadge = finding.displayRef || finding.reference || "";
      const useCanonical = Boolean(finding.snappedToCanonical && finding.canonicalText);

      // Rule 3A: Atomic Citation Rule (<= 22 words or <= 9.0 seconds -> single unified block)
      if (wordCount <= 22 || duration <= 9.0) {
        const firstW = citationWords[0];
        const lastW = citationWords[citationWords.length - 1];
        const baseText = useCanonical ? finding.canonicalText : citationWords.map(w => w.word).join(" ");
        const formattedText = `${brackets.open}${baseText}${brackets.close}${refBadge ? ` [${refBadge}]` : ""}`;

        captions.push({
          id: `cap_${captions.length + 1}`,
          index: captions.length + 1,
          start: Number(firstW.start.toFixed(2)),
          end: Number(lastW.end.toFixed(2)),
          text: baseText,
          displayText: formattedText,
          type: fType,
          findingId: finding.id,
          findingIdx,
          reference: refBadge,
          wordIds: citationWords.map(w => w.id),
          wordStartIdx: firstW.id,
          wordEndIdx: lastW.id,
          isAtomicCitation: true
        });
      } else {
        // Rule 3B: Long Ayah/Hadith (> 22 words) -> Split ONLY at internal pauses (>0.35s) or Waqf into 12-18 word chunks
        const wordChunks = splitLongCitationWords(citationWords);
        const canonWords = useCanonical ? String(finding.canonicalText).split(/\s+/).filter(Boolean) : null;
        let canonCursor = 0;

        wordChunks.forEach((chunk, cIdx) => {
          const firstW = chunk[0];
          const lastW = chunk[chunk.length - 1];
          const isFirstChunk = cIdx === 0;
          const isLastChunk = cIdx === wordChunks.length - 1;

          let chunkText = chunk.map(w => w.word).join(" ");
          if (useCanonical && canonWords && canonWords.length) {
            const ratioCount = isLastChunk
              ? (canonWords.length - canonCursor)
              : Math.max(1, Math.round((chunk.length / citationWords.length) * canonWords.length));
            chunkText = canonWords.slice(canonCursor, canonCursor + ratioCount).join(" ");
            canonCursor += ratioCount;
          }

          const openB = isFirstChunk ? brackets.open : `${brackets.open}… `;
          const closeB = isLastChunk ? brackets.close : ` …${brackets.close}`;
          const badgeSuffix = (isLastChunk && refBadge) ? ` [${refBadge}]` : "";
          const formattedText = `${openB}${chunkText}${closeB}${badgeSuffix}`;

          captions.push({
            id: `cap_${captions.length + 1}`,
            index: captions.length + 1,
            start: Number(firstW.start.toFixed(2)),
            end: Number(lastW.end.toFixed(2)),
            text: chunkText,
            displayText: formattedText,
            type: fType,
            findingId: finding.id,
            findingIdx,
            reference: isLastChunk ? refBadge : `${refBadge} (تتمة)`,
            wordIds: chunk.map(w => w.id),
            wordStartIdx: firstW.id,
            wordEndIdx: lastW.id,
            isAtomicCitation: false
          });
        });
      }

      // Rule 4: Post-Citation Flush (advance past citation; normal speech resumes in fresh block)
      i = endIdx + 1;
      continue;
    }

    // Rule 1: Normal Speech (Non-Citation)
    const currWord = words[i];
    normalBuffer.push(currWord);

    const bufLen = normalBuffer.length;
    const bufDuration = currWord.end - normalBuffer[0].start;
    const nextWord = (i + 1 < totalWords) ? words[i + 1] : null;
    const nextIsCitation = (i + 1 < totalWords) && findingByStartWord.has(i + 1);
    const pauseGap = nextWord ? (nextWord.start - currWord.end) : 999;
    const endsSentence = /[.؟!؛\n]/.test(currWord.word);

    if (
      nextIsCitation ||
      bufLen >= 12 ||
      bufDuration >= 5.0 ||
      pauseGap > 0.4 ||
      (endsSentence && bufLen >= 4)
    ) {
      flushNormalBuffer();
    }

    i++;
  }

  flushNormalBuffer();

  // Re-index sequentially
  captions.forEach((c, idx) => {
    c.index = idx + 1;
    c.id = c.id || `cap_${idx + 1}`;
  });

  return captions;
}

/**
 * Rebuild captions display text when formatting preferences or inline text change.
 */
function refreshCaptionDisplayText(cap, prefs = null) {
  if (!cap) return;
  if (!cap.type || cap.type === "normal") {
    cap.displayText = cap.text;
    return;
  }
  const brackets = getBracketsForCategory(cap.type, prefs);
  const badge = cap.reference ? ` [${cap.reference}]` : "";
  cap.displayText = `${brackets.open}${cap.text}${brackets.close}${badge}`;
}

/**
 * Export Captions to .SRT (SubRip) with ornate brackets & reference badges.
 */
function exportCaptionsToSRT(captions) {
  return (captions || []).map((c, idx) => {
    const startStr = formatSecondsToTimestamp(c.start, ",");
    const endStr = formatSecondsToTimestamp(c.end, ",");
    const body = c.displayText || c.text || "";
    return `${idx + 1}\n${startStr} --> ${endStr}\n${body}\n`;
  }).join("\n");
}

/**
 * Export Captions to .VTT (WebVTT) with CSS color classes (<c.ayah>, <c.hadith>, <c.dhikr>).
 */
function exportCaptionsToVTT(captions) {
  const header = [
    "WEBVTT",
    "",
    "STYLE",
    "::cue(c.ayah) { color: #6ee7b7; background-color: rgba(6, 78, 59, 0.82); font-family: 'Amiri', serif; }",
    "::cue(c.hadith) { color: #fcd34d; background-color: rgba(120, 53, 15, 0.82); }",
    "::cue(c.dhikr) { color: #a5b4fc; background-color: rgba(49, 46, 129, 0.82); }",
    ""
  ].join("\n");

  const blocks = (captions || []).map((c, idx) => {
    const startStr = formatSecondsToTimestamp(c.start, ".");
    const endStr = formatSecondsToTimestamp(c.end, ".");
    const rawBody = c.displayText || c.text || "";
    const wrapped = (c.type && c.type !== "normal")
      ? `<c.${c.type}>${rawBody}</c>`
      : rawBody;
    return `${idx + 1}\n${startStr} --> ${endStr}\n${wrapped}\n`;
  });

  return header + "\n" + blocks.join("\n");
}

/**
 * Export Captions to .ASS (Advanced SubStation Alpha) preserving Arabic fonts,
 * exact colors (Emerald for Ayat, Gold for Hadith, Indigo for Adhkar), and brackets.
 */
function formatAssTime(sec) {
  const s = Math.max(0, Number(sec) || 0);
  const hours = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = Math.floor(s % 60);
  const cs = Math.floor((s - Math.floor(s)) * 100);
  return `${hours}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

function exportCaptionsToASS(captions, title = "Wahy-Finder v2.0 Subtitles") {
  // ASS colors use &HAABBGGRR hex format:
  // Emerald (#10b981 -> R:10, G:b9, B:81 -> &H0081B910, bright mint #6ee7b7 -> &H00B7E76E)
  // Amber/Gold (#fcd34d -> R:fc, G:d3, B:4d -> &H004DD3FC)
  // Indigo/Teal (#a5b4fc -> R:a5, G:b4, B:fc -> &H00FCB4A5)
  const header = `[Script Info]
; Script generated by Wahy-Finder v2.0
Title: ${title}
ScriptType: v4.00+
WrapStyle: 0
ScaledBorderAndShadow: yes
YCbCr Matrix: TV.709
PlayResX: 1920
PlayResY: 1080

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,IBM Plex Sans Arabic,52,&H00F8FAFC,&H000000FF,&H001E293B,&H80090D16,0,0,0,0,100,100,0,0,3,3,1,2,80,80,65,178
Style: Ayah,Amiri,58,&H00B7E76E,&H000000FF,&H00264E06,&H90183A06,-1,0,0,0,100,100,0,0,3,3.5,1.5,2,80,80,65,178
Style: Hadith,IBM Plex Sans Arabic,54,&H004DD3FC,&H000000FF,&H000F3578,&H900B2554,-1,0,0,0,100,100,0,0,3,3.5,1.5,2,80,80,65,178
Style: Dhikr,IBM Plex Sans Arabic,54,&H00FCB4A5,&H000000FF,&H005B1E31,&H90421524,-1,0,0,0,100,100,0,0,3,3.5,1.5,2,80,80,65,178

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  const lines = (captions || []).map(c => {
    const startAss = formatAssTime(c.start);
    const endAss = formatAssTime(c.end);
    let styleName = "Default";
    if (c.type === "ayah") styleName = "Ayah";
    else if (c.type === "hadith") styleName = "Hadith";
    else if (c.type === "dhikr") styleName = "Dhikr";
    const safeText = String(c.displayText || c.text || "").replace(/\r?\n/g, "\\N");
    return `Dialogue: 0,${startAss},${endAss},${styleName},,0,0,0,,${safeText}`;
  });

  return header + lines.join("\n") + "\n";
}

window.WahyCaptionBuilder = {
  buildSmartCaptions,
  splitLongCitationWords,
  refreshCaptionDisplayText,
  formatSecondsToTimestamp,
  formatSecondsToShortTime,
  exportCaptionsToSRT,
  exportCaptionsToVTT,
  exportCaptionsToASS
};
