// Records what the OLD app's parsers (js/engine.js: synthesizeWordsFromRawText, parseSubtitleFileToWords) return for
// the inputs below, so server/tests/test_parsing.py can prove the new Python parsers give the same words and times.
// The old code is run, not re-implemented. Run from the repo root:  node server/tests/fixtures/make_parsing_golden.mjs
// Never regenerate it to make a test pass: a mismatch means the Python is wrong.
import fs from "node:fs";
import vm from "node:vm";

const sb = { console, setTimeout() {}, localStorage: { getItem: () => null, setItem() {} }, document: { getElementById: () => null }, performance: { now: () => 0 } };
sb.window = sb; sb.globalThis = sb;
vm.createContext(sb);
vm.runInContext(fs.readFileSync("js/engine.js", "utf8"), sb, { filename: "js/engine.js" });

const lecture = (id) => JSON.parse(fs.readFileSync(`engine/golden/inputs/${id}.json`, "utf8")).text;
const sample = lecture("sample");
const long = JSON.parse(fs.readFileSync("engine/golden/inputs/yt_ExkaemlknP4.json", "utf8")).words.map((w) => w.word ?? w.text ?? w).join(" ");

const SRT = `1
00:00:01,000 --> 00:00:03,500
بسم الله الرحمن الرحيم

2
00:00:04,000 --> 00:00:06,000
<i>الحمد</i> لله {\\an8}رب العالمين
والصلاة والسلام

3
01:02:03,250 --> 01:02:04,000
قصير
`;
const VTT = `WEBVTT

00:01.000 --> 00:03.000
إن الحمد لله

NOTE a comment

00:03.000 --> 00:05.333 align:start
نحمده ونستعينه ونستغفره
`;
const CRLF = SRT.replace(/\n/g, "\r\n");
const NO_CUES = "لا توجد أوقات هنا\nسطر ثان";
const EMPTY_CUE = "1\n00:00:01,000 --> 00:00:02,000\n\n\n2\n00:00:03,000 --> 00:00:03,050\nكلمة واحدة\n";

const plain = { sample, long: long.slice(0, 6000), tiny: "قال: الله، أكبر.\nنعم", spaces: "  a   b\t\tc\n\n\nd  " };
const subtitles = { srt: SRT, vtt: VTT, crlf: CRLF, no_cues: NO_CUES, empty_cue: EMPTY_CUE };

const clean = (words) => words.map((w) => [w.word, w.start, w.end]);
const out = { plain: {}, subtitles: {} };
for (const [k, text] of Object.entries(plain)) {
  sb.__in = text;
  out.plain[k] = { input: text, words: clean(vm.runInContext("synthesizeWordsFromRawText(__in)", sb)) };
}
for (const [k, text] of Object.entries(subtitles)) {
  sb.__in = text;
  out.subtitles[k] = { input: text, words: clean(vm.runInContext("parseSubtitleFileToWords(__in).words", sb)) };
}
fs.writeFileSync("server/tests/fixtures/parsing_golden.json", JSON.stringify(out, null, 1) + "\n");
console.log("plain:", Object.keys(out.plain).join(", "), "| subtitles:", Object.keys(out.subtitles).join(", "));
