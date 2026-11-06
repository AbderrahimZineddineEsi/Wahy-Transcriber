// Engine v3 (QuotationMatcherJS), moved verbatim from js/engine.js (ROADMAP phase 4). Golden tests pin it.
// Changes from the old file, all about globals, none about matching:
//   - imports and exports instead of browser globals;
//   - the default Qira'ah is a constructor param (params.defaultQiraah) instead of the page's <select>;
//   - recomputeCanonicalForDetection and its helpers (from js/state.js and js/editor.js) are appended below and
//     take the matcher as an argument instead of reading the app's global matcher;
//   - removed, because nothing in the app calls them or they only drive the page: formatAnnotatedTranscript,
//     the console test runNestedVerseTest and the WahyEngineUtils global.
import { SURAH_NAMES_AR, SURAH_NAME_TO_NUM, computeTokenIoU } from "./shared.js";

    // =========================================================================
    // 3. ARABIC NORMALIZATION, TOKENIZATION & 5-STEP MATCHER IN JS (v3.0)
    // =========================================================================
    const TASHKEEL_RE = /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED\u0640]/g;
    const STRONG_DIACRITIC_RE = /[\u064C-\u0652\u0670]/g;
    const WORD_TOKEN_RE = /[\u0610-\u061A\u0621-\u065F\u0670\u0671-\u06D3\u06D5\u06D6-\u06ED]+/g;

    const HONORIFIC_LIGATURES = [
      ["ﷺ", " صلى الله عليه وسلم "],
      ["", " عز وجل "],
      ["", " سبحانه وتعالى "],
      ["", " رضي الله عنه "],
      ["", " رضي الله عنهم "],
      ["ﷻ", " جل جلاله "]
    ];

    const MUQATTAAT_WORDS = new Set([
      "الم", "المص", "الر", "المر", "كهيعص", "طه", "طسم", "طس", "يس", "ص", "حم", "عسق", "ق", "ن"
    ]);

    const CONTINUATION_MARKER_NORMS = new Set([
      "الايه", "الايتين", "الايات", "الحديث"
    ]);

    const LOW_SPEC_WORDS = new Set([
      "من", "في", "علي", "الي", "عن", "مع", "ان", "لا", "ما", "هو", "هي", "هم",
      "ثم", "او", "بل", "قد", "لقد", "لم", "لن", "لو", "لولا", "اذا", "اذ", "كان",
      "كانت", "كانوا", "قال", "قالت", "قالوا", "يقول", "الذي", "الذين", "التي",
      "هذا", "هذه", "ذلك", "تلك", "ولقد", "فان", "وان", "بان", "وما", "ولا", "فلا",
      "وهو", "فهم", "لهم", "فيها", "منها", "عليه", "عليهم", "اليه", "اليهم", "منهم",
      "رب", "الله", "لله", "بالله", "والله", "يا", "ايها", "يايها", "كل", "بعض",
      "غير", "بعد", "قبل", "بين", "عند", "حتى", "حتي", "وعلي", "فمن", "ومن", "له",
      "بها", "به", "بهم", "بهن", "فيهن", "بكم", "عنهم", "لي", "لك", "لكم", "لنا",
      "انما", "ام", "اي", "انه", "انها", "تكون", "يكون", "كله", "كلها", "سوي", "سواه", "فيما", "بما", "عما", "مما"
    ]);

    const CITATION_AND_ISNAD_WORDS = new Set([
      "صلي", "صلوا", "عليه", "عليهم", "وسلم", "تسليما", "والسلام", "الصلاه", "الصلوه",
      "النبي", "نبي", "الرسول", "رسول", "قال", "قالت", "قالوا", "يقول", "قول", "قوله", "لقوله",
      "تعالي", "تبارك", "سبحانه", "عز", "وجل", "جل", "وعلا", "جلاله",
      "رضي", "عنه", "عنها", "عنهم", "عنهما", "رحمه", "رحمهم",
      "حدثنا", "حدثني", "اخبرنا", "اخبرني", "سمعت", "سمع", "روي", "يروي", "يرويه", "يرويها", "تروي", "روينا", "مروي", "رواه", "ورواه", "اخرجه", "خرجه",
      "الحديث", "الصحيح", "الصحيحين", "البخاري", "مسلم", "الترمذي", "النسائي", "داود", "ماجه", "احمد",
      "ابي", "ابو", "ابا", "ابن", "بن", "ام", "امير", "المؤمنين", "المومنين", "ابيه", "جده",
      "هريره", "عباس", "مسعود", "عمر", "عائشه", "انس", "جابر", "معاذ", "موسي", "مالك",
      "سهل", "سعد", "الساعدي", "عمران", "حصين", "عمرو", "عامر", "حارث", "زيد", "ثابت", "معاويه",
      "سعيد", "عبدالله", "عبدالرحمن", "يحيي", "سليمان", "اسحاق", "محمد", "احمد", "الباهلي",
      "القرشي", "الانصاري", "السلمي", "التميمي", "الهمداني", "الثقفي", "الكلابي", "البجلي", "الدمشقي",
      "اسناد", "اسناده", "ثقه", "ضعيف", "حسن", "شواهد", "متابعات", "مرفوعا", "موقوفا", "مرسلا", "منقطع", "معلقا",
      "الباب", "الفصل", "مسند", "سنن", "جامع", "موطا", "المستدرك", "الحاكم", "البيهقي", "الطبراني",
      "المعجمه", "المهمله", "المعجمتين", "المهملتين", "بالخاء", "بالحاء", "والزاي", "والراء",
      "خلافا", "خلاف", "اجماع", "العلماء", "الفقهاء", "المفسرين", "التفسير", "اصحابنا", "مذهب", "المذاهب",
      "الكوفه", "البصره", "المدينه", "الشام", "اهل", "العلم", "والايمان",
      "سفيان", "الثوري", "عيينه", "شعبه", "حماد", "ابراهيم", "الشعبي", "مجاهد", "عكرمه", "قتاده",
      "الحسن", "البصري", "الزهري", "الاعمش", "جبير", "هشام", "عمار", "صدقه", "خالد", "عطيه", "قيس",
      "غنم", "الاشعري", "بديمه", "ثوير", "فاخته", "عبيد", "زحر", "الالهاني", "القاسم", "صفوان", "عيسي",
      "الطرطوشي", "القرطبي", "الطبري", "الواحدي", "البغوي", "النووي", "الشافعي", "حنيفه", "حزم",
      "شيخه", "شيوخه", "روايه", "رواياته", "سنده", "باسناده"
    ]);

    const QUARANTINED_FORMULAS = [
      ["بسم", "الله", "الرحمن", "الرحيم"],
      ["الحمد", "لله", "رب", "العالمين"],
      ["والحمد", "لله", "رب", "العالمين"],
      ["فالحمد", "لله", "رب", "العالمين"],
      ["الحمد", "لله"],
      ["والحمد", "لله"],
      ["ان", "الحمد", "لله"],
      ["نحمده", "ونستعينه", "ونستغفره"],
      ["ونعوذ", "بالله", "من", "شرور", "انفسنا"],
      ["من", "شرور", "انفسنا", "وسيءات", "اعمالنا"],
      ["من", "شرور", "انفسنا", "ومن", "سيءات", "اعمالنا"],
      ["من", "يهده", "الله", "فلا", "مضل", "له"],
      ["ومن", "يضلل", "فلا", "هادي", "له"],
      ["فلا", "مضل", "له"],
      ["فلا", "هادي", "له"],
      ["ان", "شاء", "الله"],
      ["ما", "شاء", "الله"],
      ["سبحان", "الله"],
      ["سبحان", "الله", "وبحمده"],
      ["سبحان", "الله", "العظيم"],
      ["لا", "اله", "الا", "الله"],
      ["والله", "الذي", "لا", "اله", "الا", "هو"],
      ["الله", "اكبر"],
      ["لا", "حول", "ولا", "قوه", "الا", "بالله"],
      ["ولا", "حول", "ولا", "قوه", "الا", "بالله"],
      ["حسبنا", "الله", "ونعم", "الوكيل"],
      ["وحسبنا", "الله", "ونعم", "الوكيل"],
      ["الحمد", "لله", "الذي", "بنعمته", "تتم", "الصالحات"],
      ["والحمد", "لله", "الذي", "بنعمته", "تتم", "الصالحات"],
      ["الذي", "بنعمته", "تتم", "الصالحات"],
      ["ولا", "عدوان", "الا", "علي", "الظالمين"],
      ["والعاقبه", "للمتقين"],
      ["علي", "كل", "شيء", "قدير"],
      ["انه", "علي", "كل", "شيء", "قدير"],
      ["علي", "صراط", "مستقيم"],
      ["رسول", "الله"],
      ["عن", "رسول", "الله"],
      ["ان", "رسول", "الله"],
      ["النبي", "صلي", "الله", "عليه"],
      ["صلي", "الله", "عليه", "وسلم"],
      ["صلي", "الله", "عليه"],
      ["وصلي", "الله", "علي", "نبينا", "محمد"],
      ["وصلي", "الله", "وسلم", "علي", "نبينا", "محمد"],
      ["وصلي", "الله", "علي", "عبده", "ورسوله", "محمد"],
      ["عبده", "ورسوله", "محمد", "واله"],
      ["عليه", "الصلاه", "والسلام"],
      ["والصلاه", "والسلام", "علي"],
      ["والسلام", "علي"],
      ["السلام", "عليكم", "ورحمه", "الله"],
      ["تبارك", "وتعالي"],
      ["عز", "وجل"],
      ["الله", "عز", "وجل"],
      ["قال", "الله", "تعالي"],
      ["قال", "الله", "عز", "وجل"],
      ["قول", "الله", "عز", "وجل"],
      ["سبحانه", "وتعالي"],
      ["رضي", "الله", "عنه"],
      ["رضي", "الله", "عنها"],
      ["رضي", "الله", "عنهم"],
      ["رضي", "الله", "عنهما"],
      ["رحمه", "الله"],
      ["اعوذ", "بالله", "من", "الشيطان", "الرجيم"],
      ["فيما", "يرويه", "عن", "ربه"],
      ["يرويه", "عن", "ربه"],
      ["فيما", "يروي", "عن", "ربه"],
      ["يروي", "عن", "ربه"],
      ["عن", "ربه", "عز", "وجل"],
      ["عن", "ربه", "تبارك", "وتعالي"]
    ];

    const QURAN_CITATION_CUES = [
      ["قال", "تعالي"], ["وقال", "تعالي"], ["فقال", "تعالي"], ["قوله", "تعالي"], ["وقوله", "تعالي"], ["لقوله", "تعالي"],
      ["قال", "الله"], ["وقال", "الله"], ["يقول", "الله"], ["قول", "الله"],
      ["قال", "سبحانه"], ["وقال", "سبحانه"], ["فقال", "سبحانه"], ["قوله", "سبحانه"], ["يقول", "ربنا"], ["يقول", "سبحانه"],
      ["قال", "جل", "وعلا"], ["قول", "جل", "وعلا"], ["قوله", "جل", "وعلا"], ["يقول", "جل", "وعلا"],
      ["حيث", "قال", "عز", "وجل"], ["قال", "عز", "وجل"], ["قال", "الرب", "عز", "وجل"], ["فيها", "الرب", "عز", "وجل"],
      ["الله", "سبحانه", "قال"], ["يقل", "الله"], ["حيث", "قال"], ["امرنا", "ربنا"],
      ["في", "الايه"], ["وفي", "الايه"], ["هذه", "الايه"], ["في", "سوره"], ["وفي", "سوره"], ["في", "القران"], ["في", "كتابه"], ["في", "قوله"],
      ["بقوله", "سبحانه"], ["بقوله", "تعالي"], ["قوله", "عز", "وجل"]
    ];

    const HADITH_CITATION_CUES = [
      ["قال", "صلي", "الله", "عليه", "وسلم"], ["وقال", "صلي", "الله", "عليه", "وسلم"],
      ["قوله", "صلي", "الله", "عليه", "وسلم"], ["لقوله", "صلي", "الله", "عليه", "وسلم"],
      ["يقول", "صلي", "الله", "عليه", "وسلم"], ["النبي", "صلي", "الله", "عليه", "وسلم"],
      ["رسول", "الله", "صلي", "الله", "عليه", "وسلم"], ["قال", "عليه", "الصلاه", "والسلام"],
      ["وقال", "عليه", "الصلاه", "والسلام"], ["لقوله", "عليه", "الصلاه", "والسلام"],
      ["قوله", "عليه", "الصلاه", "والسلام"], ["عنه", "صلي", "الله", "عليه", "وسلم"],
      ["ان", "النبي", "قال"], ["سمع", "النبي", "صلي", "الله", "عليه", "وسلم", "يقول"],
      ["فقال", "رسول", "الله"], ["قال", "رسول", "الله"], ["وفي", "روايه"], ["بعض", "رواياته"],
      ["في", "الحديث"], ["وفي", "الحديث"], ["في", "الصحيح"], ["في", "الصحيحين"], ["رواه", "البخاري"], ["رواه", "مسلم"],
      ["ورد", "في", "الحديث"], ["في", "الحديث", "الصحيح"], ["جاء", "في", "الحديث"],
      ["فيما", "يرويه", "عن", "ربه"], ["يرويه", "عن", "ربه"], ["فيما", "يروي", "عن", "ربه"]
    ];

    const EXEGETICAL_MARKERS = new Set([
      "يعني", "اي", "المراد", "بمعني", "يقصد", "ومعناه", "ومعني", "تفسيره"
    ]);

    function expandHonorificLigatures(text) {
      let s = text;
      for (const [lig, exp] of HONORIFIC_LIGATURES) {
        s = s.split(lig).join(exp);
      }
      return s;
    }

    function normalizeArabic(text) {
      let s = text.replace(TASHKEEL_RE, "");
      s = s.replace(/[أإآٱ]/g, "ا");
      s = s.replace(/[ؤئ]/g, "ء");
      s = s.replace(/ءا/g, "ا");
      s = s.replace(/ى/g, "ي");
      s = s.replace(/ة/g, "ه");
      s = s.replace(/^(و|ف)?ياايها$/, "$1يايها");
      s = s.replace(/^(و|ف)?ياايتها$/, "$1يايتها");
      return s;
    }

    function isFusedTwoToOneMatch(w1, w2, target) {
      if (!w1 || !w2 || !target) return false;
      const fused = normalizeArabic(w1 + w2);
      if (fused === target) return true;
      if (target.length >= 3 && stripMedialAlefs(fused) === stripMedialAlefs(target)) return true;
      const key = `${w1}|${w2}|${target}`;
      const assimilated = new Set([
        "ان|لا|الا", "وان|لا|والا", "فان|لا|فالا",
        "من|ما|مما", "عن|ما|عما", "من|من|ممن", "عن|من|عمن",
        "ان|ما|اما", "وان|ما|واما", "فان|لم|فالم"
      ]);
      return assimilated.has(key);
    }

    function stripProclitic(word) {
      if (word.length >= 4 && ["و", "ف", "ل", "ب"].includes(word[0])) {
        return word.slice(1);
      }
      return word;
    }

    function stripMedialAlefs(word) {
      if (word.length < 3) return word;
      return word[0] + word.slice(1).replace(/ا/g, "");
    }

    function isLowSpecWord(normWord) {
      return LOW_SPEC_WORDS.has(normWord) || LOW_SPEC_WORDS.has(stripProclitic(normWord));
    }

    function isCitationOrIsnadWord(normWord) {
      return CITATION_AND_ISNAD_WORDS.has(normWord) || CITATION_AND_ISNAD_WORDS.has(stripProclitic(normWord));
    }

    function tokenizeText(text) {
      const tokens = [];
      WORD_TOKEN_RE.lastIndex = 0;
      let m;
      while ((m = WORD_TOKEN_RE.exec(text)) !== null) {
        const raw = m[0];
        const norm = normalizeArabic(raw);
        if (!norm) continue;
        tokens.push({
          idx: tokens.length,
          raw,
          norm,
          charStart: m.index,
          charEnd: m.index + raw.length
        });
      }
      return tokens;
    }

    function levenshteinLe1(s1, s2) {
      if (s1 === s2) return true;
      const n1 = s1.length, n2 = s2.length;
      if (Math.abs(n1 - n2) > 1 || Math.min(n1, n2) < 4) return false;
      if (s1[0] !== s2[0]) return false;
      if (
        (s1.endsWith("ه") && s2.endsWith("ها") && s1.slice(0, -1) === s2.slice(0, -2)) ||
        (s2.endsWith("ه") && s1.endsWith("ها") && s2.slice(0, -1) === s1.slice(0, -2))
      ) {
        return false;
      }
      let i = 0, j = 0, diffs = 0;
      while (i < n1 && j < n2) {
        if (s1[i] === s2[j]) {
          i++; j++;
        } else {
          diffs++;
          if (diffs > 1) return false;
          if (n1 > n2) i++;
          else if (n2 > n1) j++;
          else { i++; j++; }
        }
      }
      return true;
    }


    // =========================================================================
    // 3B. MULTI-QIRA'AT PRIORITY & MISMATCH RESOLUTION SYSTEM IN JS (v3.0)
    // Ordered by global number of Huffaz / prevalence across the Muslim world
    // =========================================================================
    const QIRAAT_CATALOG = [
      { key: "hafs", name: "رواية حفص عن عاصم", rank: 1 },
      { key: "warsh", name: "رواية ورش عن نافع", rank: 2 },
      { key: "qaloon", name: "رواية قالون عن نافع", rank: 3 },
      { key: "doori", name: "رواية الدوري عن أبي عمرو", rank: 4 },
      { key: "shubah", name: "رواية شعبة عن عاصم", rank: 5 },
      { key: "khalaf", name: "رواية خلف عن حمزة", rank: 6 },
      { key: "soosi", name: "رواية السوسي عن أبي عمرو", rank: 7 },
      { key: "ibn_kathir", name: "قراءة ابن كثير المكي", rank: 8 },
      { key: "ibn_amir", name: "قراءة ابن عامر الشامي", rank: 9 },
      { key: "kisai", name: "قراءة الكسائي الكوفي", rank: 10 }
    ];
    const QIRAAT_AR_NAME = Object.fromEntries(QIRAAT_CATALOG.map(q => [q.key, q.name]));
    const QIRAAT_PRIORITY_RANK = Object.fromEntries(QIRAAT_CATALOG.map(q => [q.key, q.rank]));

    const QIRAAT_FARSH_VARIANTS = {
      "1:4|مالك": [{ norm: "ملك", voc: "مَلِكِ", qiraat: ["warsh", "qaloon", "doori", "shubah", "soosi", "ibn_kathir", "ibn_amir"] }],
      "2:9|يخدعون": [{ norm: "يخادعون", voc: "يُخَادِعُونَ", qiraat: ["warsh", "qaloon", "doori", "soosi", "ibn_kathir"] }],
      "2:10|يكذبون": [{ norm: "يكذبون", voc: "يُكَذِّبُونَ", qiraat: ["warsh", "qaloon", "doori", "soosi", "ibn_kathir", "ibn_amir"] }],
      "2:132|ووصي": [{ norm: "واوصي", voc: "وَأَوْصَىٰ", qiraat: ["warsh", "qaloon", "ibn_amir"] }],
      "2:140|تقولون": [{ norm: "يقولون", voc: "يَقُولُونَ", qiraat: ["warsh", "khalaf", "kisai"] }],
      "2:184|مسكين": [{ norm: "مساكين", voc: "مَسَاكِينَ", qiraat: ["warsh", "qaloon", "ibn_amir"] }],
      "2:184|فديه": [{ norm: "فداء", voc: "فِدَاءُ", qiraat: ["warsh", "qaloon", "doori", "soosi", "ibn_kathir", "ibn_amir"] }],
      "2:259|ننشزها": [{ norm: "ننشرها", voc: "نُنْشِرُهَا", qiraat: ["warsh", "qaloon", "doori", "soosi", "ibn_kathir", "ibn_amir"] }],
      "3:133|وسارعوا": [{ norm: "سارعوا", voc: "سَارِعُوا", qiraat: ["warsh", "qaloon", "ibn_amir"] }],
      "3:146|قاتل": [{ norm: "قتل", voc: "قُتِلَ", qiraat: ["warsh", "qaloon", "doori", "soosi", "ibn_kathir"] }],
      "5:54|يرتد": [{ norm: "يرتدد", voc: "يَرْتَدِدْ", qiraat: ["warsh", "qaloon", "ibn_amir"] }],
      "6:63|انجانا": [{ norm: "انجيتنا", voc: "أَنْجَيْتَنَا", qiraat: ["khalaf", "kisai"] }],
      "7:57|بشرا": [{ norm: "نشرا", voc: "نُشُرًا", qiraat: ["warsh", "qaloon", "doori", "khalaf", "soosi", "kisai"] }],
      "10:22|يسيركم": [{ norm: "ينشركم", voc: "يَنْشُرُكُمْ", qiraat: ["ibn_amir"] }],
      "18:86|حمءه": [{ norm: "حاميه", voc: "حَامِيَةٍ", qiraat: ["shubah", "khalaf", "ibn_amir", "kisai"] }],
      "19:19|لاهب": [{ norm: "ليهب", voc: "لِيَهَبَ", qiraat: ["warsh", "qaloon", "doori", "soosi"] }],
      "24:35|يوقد": [{ norm: "توقد", voc: "تَوَقَّدُ", qiraat: ["warsh", "doori", "shubah", "soosi"] }],
      "25:48|بشرا": [{ norm: "نشرا", voc: "نُشُرًا", qiraat: ["warsh", "qaloon", "doori", "khalaf", "soosi", "kisai"] }],
      "42:30|فبما": [{ norm: "بما", voc: "بِمَا", qiraat: ["warsh", "qaloon", "ibn_amir"] }],
      "43:19|عباد": [{ norm: "عند", voc: "عِنْدَ", qiraat: ["warsh", "qaloon", "ibn_kathir"] }],
      "91:15|ولا": [{ norm: "فلا", voc: "فَلَا", qiraat: ["warsh", "qaloon", "ibn_amir"] }]
    };

    function checkWarshUsulMatch(tNorm, qNorm, qVocalized = "") {
      if (qNorm.includes("ء") && !tNorm.includes("ء")) {
        const wWaw = qNorm.replace(/ء/g, "و");
        if (tNorm === wWaw || stripMedialAlefs(tNorm) === stripMedialAlefs(wWaw)) {
          const vocW = qVocalized ? qVocalized.replace(/[ؤئأإء][ً-ْ]*/g, "و") : "";
          return { qiraah: "warsh", voc: vocW };
        }
        const wYa = qNorm.replace(/ء/g, "ي");
        if (tNorm === wYa || stripMedialAlefs(tNorm) === stripMedialAlefs(wYa)) {
          const vocY = qVocalized ? qVocalized.replace(/[ؤئأإء][ً-ْ]*/g, "ي") : "";
          return { qiraah: "warsh", voc: vocY };
        }
      }
      if (qNorm.length >= 5 && qNorm.startsWith("الا") && tNorm === "ل" + qNorm.slice(2)) {
        return { qiraah: "warsh", voc: qVocalized };
      }
      return null;
    }

    function matchWordWithQiraat(tNorm, qNorm, unitId = "", qVocalized = "") {
      if (!tNorm || !qNorm) return { qual: 0.0, qiraah: null, vocOverride: null, isAsr: false };
      if (tNorm === qNorm) return { qual: 1.0, qiraah: null, vocOverride: null, isAsr: false };

      // Check Farsh al-Huruf variants BEFORE Uthmani medial-alef stripping
      if (unitId) {
        const variants = QIRAAT_FARSH_VARIANTS[`${unitId}|${qNorm}`] || [];
        for (const v of variants) {
          if (tNorm === v.norm) {
            const bestQ = v.qiraat.slice().sort((a, b) => (QIRAAT_PRIORITY_RANK[a] || 99) - (QIRAAT_PRIORITY_RANK[b] || 99))[0];
            return { qual: 1.0, qiraah: bestQ, vocOverride: v.voc, isAsr: false };
          }
        }
      }

      if (Math.min(tNorm.length, qNorm.length) >= 3 && stripMedialAlefs(tNorm) === stripMedialAlefs(qNorm)) {
        return { qual: 0.95, qiraah: null, vocOverride: null, isAsr: false };
      }

      // Check Warsh / Soosi Usul (Ibdal al-Hamz & Naql)
      const usulHit = checkWarshUsulMatch(tNorm, qNorm, qVocalized);
      if (usulHit) {
        return { qual: 1.0, qiraah: usulHit.qiraah, vocOverride: usulHit.voc, isAsr: false };
      }

      // Fallback: ASR / Orthographic Fuzzy Match
      if (Math.max(tNorm.length, qNorm.length) >= 4 && Math.min(tNorm.length, qNorm.length) >= 3) {
        if (stripProclitic(tNorm) === stripProclitic(qNorm)) {
          return { qual: 0.90, qiraah: null, vocOverride: null, isAsr: true };
        }
      }
      if (tNorm.length >= 4 && qNorm.length >= 4) {
        if (levenshteinLe1(tNorm, qNorm) || levenshteinLe1(stripMedialAlefs(tNorm), stripMedialAlefs(qNorm))) {
          return { qual: 0.85, qiraah: null, vocOverride: null, isAsr: true };
        }
      }
      return { qual: 0.0, qiraah: null, vocOverride: null, isAsr: false };
    }

    function wordMatchQuality(tNorm, qNorm, unitId = "", qVocalized = "") {
      return matchWordWithQiraat(tNorm, qNorm, unitId, qVocalized).qual;
    }

    function stripIsnad(hadithText) {
      let text = expandHonorificLigatures(hadithText);
      const toks = tokenizeText(text);
      if (toks.length < 6) return text;
      const norms = toks.map(t => t.norm);
      const limit = Math.min(norms.length - 4, 95);
      let bestCut = 0;
      // Claude Blocker #4 Fix: Never include 'ان' ('إنّ') in extraSkip, and stop right after 'قال'/'يقول' (and optional Qudsi framing)
      // so Hadiths beginning with 'إِنَّ اللَّهَ كَتَبَ الإِحْسَانَ...' (Tirmidhi 1409 & Nawawi 17) keep their leading 'إن'!
      const qudsiFollow = new Set(["فيما", "يرويه", "يروي", "عن", "ربه", "تبارك", "وتعالي", "عز", "وجل", "انه", "قال"]);

      if (["عن", "حدثنا", "حدثني", "اخبرنا", "اخبرني", "روي"].includes(norms[0])) {
        for (let i = 1; i < Math.min(norms.length - 3, 28); i++) {
          if (["قال", "قالت", "يقول"].includes(norms[i])) {
            bestCut = Math.max(bestCut, i + 1);
            break;
          }
        }
      }
      for (let i = 0; i < limit; i++) {
        if (
          norms[i] === "صلي" &&
          norms[i + 1] === "الله" &&
          norms[i + 2] === "عليه" &&
          norms[i + 3] === "وسلم"
        ) {
          let cut = i + 4;
          while (cut < Math.min(norms.length, i + 16)) {
            const w = norms[cut];
            if (["قال", "قالت", "يقول"].includes(w)) {
              cut++;
              while (cut < Math.min(norms.length, i + 24) && qudsiFollow.has(norms[cut])) {
                cut++;
              }
              break;
            }
            if (isCitationOrIsnadWord(w) || w === "انه") {
              cut++;
            } else {
              break;
            }
          }
          if (cut > bestCut) bestCut = cut;
        }
      }

      let endCut = toks.length;
      const takhrijTails = [
        ["قال", "ابو", "عيسي"],
        ["قال", "الترمذي"],
        ["وفي", "الباب", "عن"],
        ["وهذا", "حديث", "حسن"],
        ["وهذا", "اسناد", "صحيح"],
        ["متفق", "عليه"],
        ["رواه", "السبعه"],
        ["اخرجه", "البخاري"]
      ];
      for (let i = Math.max(bestCut + 3, 4); i < norms.length - 2; i++) {
        for (const tail of takhrijTails) {
          let ok = true;
          for (let k = 0; k < tail.length; k++) {
            if (norms[i + k] !== tail[k]) { ok = false; break; }
          }
          if (ok) { endCut = Math.min(endCut, i); break; }
        }
        if (endCut < toks.length) break;
      }

      const startChar = (bestCut > 0 && bestCut < endCut - 2) ? toks[bestCut].charStart : 0;
      const endChar = endCut < toks.length ? toks[endCut - 1].charEnd : text.length;
      return text.slice(startChar, endChar);
    }

    // =========================================================================
    // 4. MATCHER INDEX & 5-STEP ENGINE (v3.0)
    // =========================================================================
    class QuotationMatcherJS {
      constructor(quranData, hadithData, params = {}, adhkarData = [], outsideHadithData = []) {
        this.defaultQiraah = params.defaultQiraah ?? "AUTO";
        this.minIslandIdf = params.minIslandIdf ?? 3.8;
        this.maxTranscriptGap = params.maxTranscriptGap ?? 10;
        this.maxVerseGap = params.maxVerseGap ?? 2;
        this.verifiedThreshold = params.verifiedThreshold ?? 11.0;
        this.candidateThreshold = params.candidateThreshold ?? 6.8;
        this.uncuedHadithThreshold = params.uncuedHadithThreshold ?? 16.0;
        this.minHadithContentWords = params.minHadithContentWords ?? 3;
        this.uncuedQuranCoverage = (params.uncuedQuranCoverage ?? 65) / 100.0;

        this.units = new Map();
        this.quranUnits = [];
        this.hadithUnits = [];
        this.adhkarUnits = [];
        this.outsideHadithUnits = [];

        for (const q of quranData) {
          const uid = `${q.s}:${q.a}`;
          const sName = SURAH_NAMES_AR[q.s] || `سورة ${q.s}`;
          const toks = tokenizeText(q.t);
          const unit = {
            sourceType: "QURAN",
            unitId: uid,
            surah: q.s,
            ayah: q.a,
            displayRef: `${sName}: ${q.a}`,
            vocalizedWords: toks.map(t => t.raw),
            normWords: toks.map(t => t.norm),
            fullText: q.t
          };
          this.units.set(uid, unit);
          this.quranUnits.push(unit);
        }

        for (const h of hadithData) {
          // a corpus that ships its own isnad/matn split (Open Hadith Data) is used as-is; otherwise guess the cut
          const matn = h.matn ? expandHonorificLigatures(h.matn) : (h.book === "Builtin" ? h.t : stripIsnad(h.t));
          const toks = tokenizeText(matn);
          if (toks.length < 2) continue;
          const unit = {
            sourceType: "HADITH",
            unitId: h.id,
            bookKey: h.book || String(h.id).split(":")[0] || "Builtin",
            surah: 0,
            ayah: 0,
            displayRef: h.ref,
            vocalizedWords: toks.map(t => t.raw),
            normWords: toks.map(t => t.norm),
            fullText: h.t
          };
          this.units.set(h.id, unit);
          this.hadithUnits.push(unit);
        }

        for (const a of (adhkarData || [])) {
          const toks = tokenizeText(a.t);
          if (toks.length < 2) continue;
          const unit = {
            sourceType: "ADHKAR",
            unitId: a.id,
            bookKey: "Adhkar",
            surah: 0,
            ayah: 0,
            displayRef: "ذكر",
            vocalizedWords: toks.map(t => t.raw),
            normWords: toks.map(t => t.norm),
            fullText: a.t
          };
          this.units.set(a.id, unit);
          this.adhkarUnits.push(unit);
        }

        for (const oh of (outsideHadithData || [])) {
          const matn = stripIsnad(oh.t || "");
          const toks = tokenizeText(matn);
          if (toks.length < 2) continue;
          const unit = {
            sourceType: "HADITH",
            unitId: oh.id,
            bookKey: "OutsideCorpus",
            isOutsideCorpus: true,
            surah: 0,
            ayah: 0,
            displayRef: oh.ref || "حديث خارج القاعدة",
            vocalizedWords: toks.map(t => t.raw),
            normWords: toks.map(t => t.norm),
            fullText: oh.t
          };
          this.units.set(oh.id, unit);
          this.hadithUnits.push(unit);
          this.outsideHadithUnits.push(unit);
        }

        this.wordIdf = new Map();
        this.bigramIndex = new Map();
        this.rareUnigramIndex = new Map();
        this._buildIndexes();
      }

      _buildIndexes() {
        const df = new Map();
        const effectiveN = Math.max(this.quranUnits.length, 6236);
        for (const u of this.quranUnits) {
          const unique = new Set(u.normWords);
          for (const w of unique) {
            df.set(w, (df.get(w) || 0) + 1);
          }
        }

        const hadithDf = new Map();
        const hadithScale = Math.max(1.0, this.hadithUnits.length / 6236.0);
        for (const u of this.hadithUnits) {
          const unique = new Set(u.normWords);
          for (const w of unique) {
            hadithDf.set(w, (hadithDf.get(w) || 0) + 1);
          }
        }

        const allVocab = new Set([...df.keys(), ...hadithDf.keys()]);
        for (const w of allVocab) {
          const docCount = df.has(w) ? df.get(w) : (hadithDf.get(w) / hadithScale);
          let rawIdf = Math.log(effectiveN / (1.0 + docCount));
          if (isLowSpecWord(w)) rawIdf *= 0.15;
          this.wordIdf.set(w, Math.max(rawIdf, 0.15));
        }

        for (const w of Array.from(this.wordIdf.keys())) {
          const base = stripProclitic(w);
          if (base !== w && this.wordIdf.has(base)) {
            this.wordIdf.set(w, Math.min(this.wordIdf.get(w), this.wordIdf.get(base)));
          }
        }

        for (const [uid, unit] of this.units.entries()) {
          const words = unit.normWords;
          const isHadith = unit.sourceType === "HADITH";
          if (!isHadith && words.length === 1) {
            const w0 = words[0];
            if (!this.rareUnigramIndex.has(w0)) this.rareUnigramIndex.set(w0, []);
            this.rareUnigramIndex.get(w0).push([uid, 0]);
          }
          for (let j = 0; j < words.length - 1; j++) {
            if (
              isHadith &&
              (isCitationOrIsnadWord(words[j]) || isLowSpecWord(words[j])) &&
              (isCitationOrIsnadWord(words[j + 1]) || isLowSpecWord(words[j + 1]))
            ) {
              continue;
            }
            const key = `${words[j]}|${words[j + 1]}`;
            if (!this.bigramIndex.has(key)) this.bigramIndex.set(key, []);
            this.bigramIndex.get(key).push([uid, j]);
          }
          for (let j = 0; j < words.length; j++) {
            const w = words[j];
            if (isHadith && isCitationOrIsnadWord(w)) continue;
            if (w.length >= 4 && this.getIdf(w) >= 4.2 && !isLowSpecWord(w)) {
              if (!this.rareUnigramIndex.has(w)) this.rareUnigramIndex.set(w, []);
              this.rareUnigramIndex.get(w).push([uid, j]);
            }
            if (!isHadith) {
              const fVars = (QIRAAT_FARSH_VARIANTS[`${uid}|${w}`] || []).map(v => v.norm);
              const skelW = stripMedialAlefs(w);
              if (skelW !== w && skelW.length >= 3) fVars.push(skelW);
              if (w.includes("ء")) {
                fVars.push(w.replace(/ء/g, "و"), w.replace(/ء/g, "ي"));
              }
              for (const altW of fVars) {
                if (altW.length >= 4 && !isLowSpecWord(altW)) {
                  if (!this.rareUnigramIndex.has(altW)) this.rareUnigramIndex.set(altW, []);
                  this.rareUnigramIndex.get(altW).push([uid, j]);
                }
                if (j > 0) {
                  const k1 = `${words[j - 1]}|${altW}`;
                  if (!this.bigramIndex.has(k1)) this.bigramIndex.set(k1, []);
                  this.bigramIndex.get(k1).push([uid, j - 1]);
                }
                if (j + 1 < words.length) {
                  const k2 = `${altW}|${words[j + 1]}`;
                  if (!this.bigramIndex.has(k2)) this.bigramIndex.set(k2, []);
                  this.bigramIndex.get(k2).push([uid, j]);
                }
              }
            }
          }
        }
      }

      getIdf(normWord) {
        if (MUQATTAAT_WORDS.has(normWord)) return 6.5;
        if (isLowSpecWord(normWord)) return this.wordIdf.get(normWord) ?? 0.20;
        const base = stripProclitic(normWord);
        if (this.wordIdf.has(normWord) && this.wordIdf.has(base)) {
          return Math.min(this.wordIdf.get(normWord), this.wordIdf.get(base));
        }
        if (this.wordIdf.has(normWord)) return this.wordIdf.get(normWord);
        if (this.wordIdf.has(base)) return this.wordIdf.get(base);
        return 5.5;
      }

      _findQuarantinedMask(tNorms) {
        const n = tNorms.length;
        const mask = new Array(n).fill(false);
        for (const formula of QUARANTINED_FORMULAS) {
          const flen = formula.length;
          for (let i = 0; i <= n - flen; i++) {
            const firstMatch = (tNorms[i] === formula[0] || stripProclitic(tNorms[i]) === formula[0]);
            if (!firstMatch) continue;
            let ok = true;
            for (let k = 1; k < flen; k++) {
              if (tNorms[i + k] !== formula[k]) { ok = false; break; }
            }
            if (ok) {
              for (let k = i; k < i + flen; k++) mask[k] = true;
            }
          }
        }
        return mask;
      }

      _hasCitationCue(tNorms, tStart, sourceType, tEnd = null) {
        const winStart = Math.max(0, tStart - 8);
        const winEnd = (tStart < tNorms.length && tNorms[tStart] === "الله") ? (tStart + 1) : tStart;
        const window = tNorms.slice(winStart, winEnd);
        // Claude Blocker #5 Fix: If checking for a QURAN cue, reject if the immediate window has an explicit HADITH cue ('عليه الصلاة والسلام', 'صلى الله عليه وسلم', 'رسول الله', 'النبي')
        if (sourceType === "QURAN") {
          const nearWin = tNorms.slice(Math.max(0, tStart - 6), tStart);
          for (const hCue of HADITH_CITATION_CUES) {
            const hlen = hCue.length;
            for (let i = 0; i <= nearWin.length - hlen; i++) {
              let hOk = true;
              for (let k = 0; k < hlen; k++) {
                const wTok = nearWin[i + k];
                if (k === 0 ? (wTok !== hCue[0] && stripProclitic(wTok) !== hCue[0]) : (wTok !== hCue[k])) { hOk = false; break; }
              }
              if (hOk) return false;
            }
          }
          // Allow standalone 'قوله' / 'بقوله' right before the span ONLY when not preceded by scholar/hadith markers
          if (tStart > 0 && ["قوله", "بقوله", "كقوله", "لقوله"].includes(tNorms[tStart - 1])) {
            const prev3 = tNorms.slice(Math.max(0, tStart - 4), tStart - 1);
            const nonQuranSpeakers = new Set(["صلي", "وسلم", "والسلام", "النبي", "رسول", "رحمه", "العلماء", "المفسرين", "الشافعي", "احمد", "مالك"]);
            if (!prev3.some(w => nonQuranSpeakers.has(w))) return true;
          }
        }
        const cues = sourceType === "QURAN" ? QURAN_CITATION_CUES : HADITH_CITATION_CUES;
        for (const cue of cues) {
          const clen = cue.length;
          for (let i = 0; i <= window.length - clen; i++) {
            let ok = true;
            for (let k = 0; k < clen; k++) {
              const wTok = window[i + k];
              if (k === 0 ? (wTok !== cue[0] && stripProclitic(wTok) !== cue[0]) : (wTok !== cue[k])) { ok = false; break; }
            }
            if (ok) return true;
          }
        }
        if (tEnd !== null && sourceType === "HADITH") {
          const postWin = tNorms.slice(tEnd, Math.min(tNorms.length, tEnd + 6));
          if (postWin.length >= 2 && postWin[0] === "كما" && ["قال", "يقول", "ثبت", "صح"].includes(postWin[1])) {
            const postCues = [
              ["قال", "صلي", "الله", "عليه", "وسلم"],
              ["قال", "عليه", "الصلاه", "والسلام"],
              ["قال", "رسول", "الله"],
              ["قال", "النبي"]
            ];
            for (const cue of postCues) {
              const clen = cue.length;
              for (let i = 0; i <= postWin.length - clen; i++) {
                let ok = true;
                for (let k = 0; k < clen; k++) {
                  if (postWin[i + k] !== cue[k]) { ok = false; break; }
                }
                if (ok) return true;
              }
            }
          }
        }
        return false;
      }

      _seedAndExpandIslands(tokens) {
        const tNorms = tokens.map(t => t.norm);
        const nTok = tNorms.length;
        const quarantineMask = this._findQuarantinedMask(tNorms);
        const rawSeeds = [];

        for (let i = 0; i < nTok - 1; i++) {
          const w1 = tNorms[i], w2 = tNorms[i + 1];
          const s1 = stripMedialAlefs(w1), s2 = stripMedialAlefs(w2);
          const candidateBgs = new Set([`${w1}|${w2}`, `${s1}|${w2}`, `${w1}|${s2}`, `${s1}|${s2}`]);
          for (const bg of candidateBgs) {
            const hits = this.bigramIndex.get(bg);
            if (hits) {
              for (const [uid, qIdx] of hits) rawSeeds.push([uid, i, qIdx]);
            }
          }
        }

        for (let i = 0; i < nTok; i++) {
          const w = tNorms[i];
          if (w.length >= 3 || MUQATTAAT_WORDS.has(w)) {
            const hits = this.rareUnigramIndex.get(w);
            if (hits) {
              for (const [uid, qIdx] of hits) rawSeeds.push([uid, i, qIdx]);
            }
            const skelW = stripMedialAlefs(w);
            if (skelW !== w && skelW.length >= 3) {
              const skelHits = this.rareUnigramIndex.get(skelW);
              if (skelHits) {
                for (const [uid, qIdx] of skelHits) rawSeeds.push([uid, i, qIdx]);
              }
            }
          }
        }

        const islandsByUnit = new Map();
        const seenSpans = new Set();

        for (const [uid, tSeed, qSeed] of rawSeeds) {
          const unit = this.units.get(uid);
          const qNorms = unit.normWords;
          const qLen = qNorms.length;
          const isHadith = unit.sourceType === "HADITH";
          const isMuqattaatUnit = (!isHadith && qLen === 1);

          const existingList = islandsByUnit.get(uid) || [];
          let alreadyCovered = false;
          for (const ex of existingList) {
            if (
              ex.tStart <= tSeed && tSeed < ex.tEnd &&
              ex.qStart <= qSeed && qSeed < ex.qEnd &&
              (tSeed - ex.tStart) === (qSeed - ex.qStart)
            ) {
              alreadyCovered = true;
              break;
            }
          }
          if (alreadyCovered) continue;

          let tS = tSeed, qS = qSeed;
          while (tS > 0 && qS > 0) {
            if (wordMatchQuality(tNorms[tS - 1], qNorms[qS - 1], uid, unit.vocalizedWords[qS - 1]) > 0.0) {
              tS--; qS--;
            } else if (tS >= 2 && isFusedTwoToOneMatch(tNorms[tS - 2], tNorms[tS - 1], qNorms[qS - 1])) {
              tS -= 2; qS -= 1;
            } else if (qS >= 2 && isFusedTwoToOneMatch(qNorms[qS - 2], qNorms[qS - 1], tNorms[tS - 1])) {
              tS -= 1; qS -= 2;
            } else if (["ايها", "ايتها"].includes(tNorms[tS - 1]) && ["يايها", "يايتها", "ويايها", "فيايها"].includes(qNorms[qS - 1])) {
              tS -= 1; qS -= 1;
              if (tS > 0 && ["يا", "ويا", "فيا"].includes(tNorms[tS - 1])) tS -= 1;
            } else break;
          }

          let tE = tSeed + 1, qE = qSeed + 1;
          let boundaryHealed = false;
          const weakSetB = new Set(["ا", "و", "ي", "ه", "ة"]);
          while (tE < nTok && qE < qLen) {
            if (wordMatchQuality(tNorms[tE], qNorms[qE], uid, unit.vocalizedWords[qE]) > 0.0) {
              tE++; qE++;
              continue;
            }
            if (tE + 1 < nTok && isFusedTwoToOneMatch(tNorms[tE], tNorms[tE + 1], qNorms[qE])) {
              tE += 2; qE += 1;
              continue;
            }
            if (qE + 1 < qLen && isFusedTwoToOneMatch(qNorms[qE], qNorms[qE + 1], tNorms[tE])) {
              tE += 1; qE += 2;
              continue;
            }
            // Case A: 1 inserted pronoun/function word before matching next word ('هم يقفرون' -> 'يكفرون' in 29:67)
            if (
              (tE - tS) >= 3 &&
              tE + 1 < nTok &&
              isLowSpecWord(tNorms[tE]) &&
              wordMatchQuality(tNorms[tE + 1], qNorms[qE]) >= 0.85 &&
              !isLowSpecWord(qNorms[qE])
            ) {
              tE += 2;
              qE += 1;
              boundaryHealed = true;
              continue;
            }
            // Case B: 1-2 word ASR distortion followed immediately by a matching next word ('على يالي عشر' -> 'عليها لعشر', 'أفضل الباطل يؤمنون')
            let extendedB = false;
            if ((tE - tS) >= 3) {
              for (const dT of [1, 2]) {
                for (const dQ of [1, 2]) {
                  if (tE + dT < nTok && qE + dQ < qLen) {
                    const nextQual = wordMatchQuality(tNorms[tE + dT], qNorms[qE + dQ]);
                    if (nextQual >= 0.85 && !isLowSpecWord(qNorms[qE + dQ])) {
                      const tSkipStr = tNorms.slice(tE, tE + dT).join("");
                      const qSkipStr = qNorms.slice(qE, qE + dQ).join("");
                      const tCons = new Set(tSkipStr.split("").filter(c => !weakSetB.has(c)));
                      const qCons = new Set(qSkipStr.split("").filter(c => !weakSetB.has(c)));
                      let sc = 0;
                      for (const c of tCons) { if (qCons.has(c)) sc++; }
                      const allT = new Set(tSkipStr.split(""));
                      const allQ = new Set(qSkipStr.split(""));
                      let sa = 0;
                      for (const c of allT) { if (allQ.has(c)) sa++; }
                      if (sc >= 2 || sa >= 3) {
                        tE += dT + 1;
                        qE += dQ + 1;
                        boundaryHealed = true;
                        extendedB = true;
                        break;
                      }
                    }
                  }
                }
                if (extendedB) break;
              }
            }
            if (!extendedB) break;
          }

          // Left-Boundary Lookbehind once anchored ((tE - tS) >= 4 and qS > 0 and tS > 0)
          if (!isHadith && (tE - tS) >= 4 && qS > 0 && tS > 0) {
            let leftHealed = false;
            for (const dTLeft of [1, 2, 3]) {
              if (tS - dTLeft < 0) break;
              for (let qCand = Math.max(0, qS - 4); qCand < qS; qCand++) {
                if (
                  wordMatchQuality(tNorms[tS - dTLeft], qNorms[qCand]) >= 0.85 &&
                  !isLowSpecWord(qNorms[qCand]) &&
                  this._hasCitationCue(tNorms, tS - dTLeft, "QURAN")
                ) {
                  tS -= dTLeft;
                  qS = qCand;
                  boundaryHealed = true;
                  leftHealed = true;
                  break;
                }
              }
              if (leftHealed) break;
            }
          }

          // Claude Blocker #1 Fix: Clamp indices & strictly bound qS < qE && qS < qLen and qE > qS && qE <= qLen
          tS = Math.max(0, Math.min(nTok, tS));
          tE = Math.max(tS, Math.min(nTok, tE));
          qS = Math.max(0, Math.min(qLen, qS));
          qE = Math.max(qS, Math.min(qLen, qE));

          if (
            !isHadith &&
            tS > 0 &&
            tS < nTok &&
            qS < qLen &&
            qNorms[qS] &&
            tNorms[tS] &&
            (tNorms[tS - 1] === "يا" || tNorms[tS - 1] === "ويا" || tNorms[tS - 1] === "فيا") &&
            qNorms[qS].startsWith("يا") &&
            !tNorms[tS].startsWith("يا")
          ) {
            tS--;
          }
          while (
            tS < tE &&
            qS < qE &&
            qS < qLen &&
            ((!boundaryHealed && wordMatchQuality(tNorms[tS], qNorms[qS], uid, unit.vocalizedWords[qS]) === 0.0 &&
              !(!isHadith && qNorms[qS] && (
                ((tNorms[tS] === "يا" || tNorms[tS] === "ويا" || tNorms[tS] === "فيا") && qNorms[qS].startsWith("يا")) ||
                (tS + 1 < tE && isFusedTwoToOneMatch(tNorms[tS], tNorms[tS + 1], qNorms[qS])) ||
                (["ايها", "ايتها"].includes(tNorms[tS]) && qNorms[qS].endsWith("ايها"))
              ))) ||
             (isHadith && (isCitationOrIsnadWord(tNorms[tS]) || quarantineMask[tS])))
          ) {
            tS++; qS++;
          }
          while (
            tE > tS &&
            qE > qS &&
            qE - 1 >= 0 &&
            qE - 1 < qLen &&
            ((!boundaryHealed && wordMatchQuality(tNorms[tE - 1], qNorms[qE - 1], uid, unit.vocalizedWords[qE - 1]) === 0.0) ||
             (isHadith && (isCitationOrIsnadWord(tNorms[tE - 1]) || quarantineMask[tE - 1])))
          ) {
            tE--; qE--;
          }

          if (tE <= tS || qE <= qS || qS >= qLen) continue;
          qE = Math.min(qLen, qE);
          const matchLen = tE - tS;
          if (matchLen < 2 && !(isMuqattaatUnit && matchLen === 1)) continue;

          const spanKey = `${uid}|${tS}|${tE}|${qS}|${qE}`;
          if (seenSpans.has(spanKey)) continue;
          seenSpans.add(spanKey);

          let idfSum = 0.0, matchedCnt = 0, contentCnt = 0, hasFuzzyHeal = boundaryHealed;
          let detectedQiraah = "hafs";
          const vocalizedOverrides = {};
          const qSpanLen = qE - qS;
          for (let offset = 0; offset < qSpanLen; offset++) {
            const qIdx = qS + offset;
            const centerT = tS + offset;
            let bestQual = 0.0;
            let bestTIdx = Math.min(tE - 1, Math.max(tS, centerT));
            let bestQiraah = null;
            let bestVocOvr = null;
            let bestIsAsr = false;
            for (let candT = Math.max(tS, centerT - 2); candT < Math.min(tE, centerT + 3); candT++) {
              const mRes = matchWordWithQiraat(tNorms[candT], qNorms[qIdx], !isHadith ? uid : "", unit.vocalizedWords[qIdx]);
              if (mRes.qual > bestQual) {
                bestQual = mRes.qual;
                bestTIdx = candT;
                bestQiraah = mRes.qiraah;
                bestVocOvr = mRes.vocOverride;
                bestIsAsr = mRes.isAsr;
              }
            }
            const qual = bestQual;
            const tIdx = bestTIdx;
            if (qual > 0.0) {
              if (bestQiraah && !isHadith) {
                if (detectedQiraah === "hafs" || (QIRAAT_PRIORITY_RANK[bestQiraah] || 99) < (QIRAAT_PRIORITY_RANK[detectedQiraah] || 99)) {
                  detectedQiraah = bestQiraah;
                }
                if (bestVocOvr) vocalizedOverrides[qIdx] = bestVocOvr;
              } else if (bestIsAsr) {
                hasFuzzyHeal = true;
              }
              const qw = qNorms[qIdx];
              const tw = tNorms[tIdx];
              matchedCnt++;
              if (isHadith && (isCitationOrIsnadWord(tw) || quarantineMask[tIdx])) {
                idfSum += 0.15;
              } else {
                idfSum += this.getIdf(qw) * qual;
                if (
                  (!isLowSpecWord(qw) || MUQATTAAT_WORDS.has(qw)) &&
                  (!isLowSpecWord(tw) || MUQATTAAT_WORDS.has(tw)) &&
                  !(isHadith && isCitationOrIsnadWord(tw)) &&
                  !quarantineMask[tIdx]
                ) {
                  contentCnt++;
                }
              }
            }
          }

          const isAdhkar = unit.sourceType === "ADHKAR";
          let isQuarantined = !isMuqattaatUnit && !isAdhkar;
          if (isQuarantined) {
            for (let k = tS; k < tE; k++) {
              if (!quarantineMask[k] && !isLowSpecWord(tNorms[k])) { isQuarantined = false; break; }
            }
          }

          if (idfSum >= this.minIslandIdf || isQuarantined || isMuqattaatUnit) {
            if (!islandsByUnit.has(uid)) islandsByUnit.set(uid, []);
            islandsByUnit.get(uid).push({
              unitId: uid,
              tStart: tS,
              tEnd: tE,
              qStart: qS,
              qEnd: qE,
              idfScore: idfSum,
              matchedCount: matchedCnt,
              contentCount: contentCnt,
              hasFuzzyHeal,
              isQuarantined,
              detectedQiraah,
              vocalizedOverrides
            });
          }
        }
        return islandsByUnit;
      }

      _chainIslandsForUnit(uid, islands, tNorms) {
        const unit = this.units.get(uid);
        const isHadith = unit.sourceType === "HADITH";
        const isAdhkar = unit.sourceType === "ADHKAR";
        const isMuqattaatUnit = (!isHadith && unit.normWords.length === 1);

        islands.sort((a, b) => (a.tStart - b.tStart) || (a.qStart - b.qStart) || (b.tEnd - a.tEnd));
        const m = islands.length;
        if (m === 0) return [];

        const dpScore = new Array(m).fill(0.0);
        const dpParent = new Array(m).fill(-1);

        for (let i = 0; i < m; i++) {
          const islI = islands[i];
          const hasCueI = this._hasCitationCue(tNorms, islI.tStart, unit.sourceType);
          const baseI = (islI.isQuarantined && !hasCueI) ? 0.0 : (islI.idfScore + (hasCueI ? 3.0 : 0.0));
          dpScore[i] = baseI;

          if ((islI.idfScore < this.minIslandIdf && !isMuqattaatUnit) || islI.isQuarantined) continue;

          for (let j = 0; j < i; j++) {
            const islJ = islands[j];
            if (dpScore[j] <= 0.0 || islJ.isQuarantined) continue;
            const deltaT = islI.tStart - islJ.tEnd;
            const deltaQ = islI.qStart - islJ.qEnd;
            if (isHadith && !(deltaT >= 0 && deltaT <= 6 && deltaQ >= 0 && deltaQ <= 6 && Math.abs(deltaT - deltaQ) <= 2)) continue;
            const maxTGap = isHadith ? 6 : this.maxTranscriptGap;

            if (
              deltaT >= 0 &&
              deltaT <= maxTGap &&
              deltaQ >= 0 &&
              deltaQ <= this.maxVerseGap &&
              (deltaT + deltaQ) >= 1
            ) {
              const gapTokens = tNorms.slice(islJ.tEnd, islI.tStart);
              const hasExegetical = gapTokens.length > 0 && gapTokens.slice(0, 2).some(w => EXEGETICAL_MARKERS.has(w));
              let isAsrVerseDistortion = false;
              if (!isHadith && deltaT >= 1 && deltaT <= 2 && deltaQ >= 1 && deltaQ <= 2 && Math.abs(deltaT - deltaQ) <= 1 && !hasExegetical) {
                const qGapWords = unit.normWords.slice(islJ.qEnd, islI.qStart);
                const pronounFlip = (
                  gapTokens.length === 1 && qGapWords.length === 1 &&
                  ((gapTokens[0].endsWith("ه") && qGapWords[0].endsWith("ها") && gapTokens[0].slice(0, -1) === qGapWords[0].slice(0, -2)) ||
                   (qGapWords[0].endsWith("ه") && gapTokens[0].endsWith("ها") && qGapWords[0].slice(0, -1) === gapTokens[0].slice(0, -2)))
                );
                const weakSet = new Set(["ا", "و", "ي", "ه", "ة"]);
                const tChars = new Set(gapTokens.join("").split("").filter(c => !weakSet.has(c)));
                const qChars = new Set(qGapWords.join("").split("").filter(c => !weakSet.has(c)));
                let sharedCons = 0;
                for (const c of tChars) { if (qChars.has(c)) sharedCons++; }
                const allT = new Set(gapTokens.join("").split(""));
                const allQ = new Set(qGapWords.join("").split(""));
                let sharedAll = 0;
                for (const c of allT) { if (allQ.has(c)) sharedAll++; }
                if (!pronounFlip && (sharedCons >= 2 || sharedAll >= 3) && (islJ.matchedCount + islI.matchedCount) >= 5) {
                  isAsrVerseDistortion = true;
                }
              }
              if (!isHadith && deltaT >= 1 && !hasExegetical && !isAsrVerseDistortion) {
                if (!(deltaT <= 2 && islJ.matchedCount >= 4 && islI.matchedCount >= 4 && islJ.idfScore >= 9.0 && islI.idfScore >= 9.0)) {
                  continue;
                }
              }
              let tPenalty = 0.45 * deltaT;
              if (hasExegetical) tPenalty *= 0.50;
              const qPenalty = 1.5 * deltaQ;
              const candScore = dpScore[j] + islI.idfScore - (tPenalty + qPenalty);
              if (candScore > dpScore[i]) {
                dpScore[i] = candScore;
                dpParent[i] = j;
              }
            }
          }
        }

        const usedIndices = new Set();
        const detections = [];
        const order = Array.from({ length: m }, (_, i) => i).sort((a, b) => dpScore[b] - dpScore[a]);

        for (const endIdx of order) {
          if (usedIndices.has(endIdx) || dpScore[endIdx] < this.candidateThreshold) continue;
          const chainIndices = [];
          let curr = endIdx;
          while (curr !== -1) {
            chainIndices.push(curr);
            curr = dpParent[curr];
          }
          chainIndices.reverse();
          if (chainIndices.some(idx => usedIndices.has(idx))) continue;

          const chainIslands = chainIndices.map(idx => islands[idx]);
          const totalMatched = chainIslands.reduce((acc, x) => acc + x.matchedCount, 0);
          const totalContent = chainIslands.reduce((acc, x) => acc + x.contentCount, 0);
          let hasFuzzyHeal = chainIslands.some(x => x.hasFuzzyHeal);

          const firstIsl = chainIslands[0];
          const lastIslPre = chainIslands[chainIslands.length - 1];
          const hasCue = this._hasCitationCue(tNorms, firstIsl.tStart, unit.sourceType, lastIslPre.tEnd);

          // Negation Polarity Guard
          if (
            firstIsl.tStart > 0 &&
            ["لا", "ما", "لم", "لن", "ليس", "غير", "عدم"].includes(tNorms[firstIsl.tStart - 1]) &&
            (firstIsl.qStart === 0 || !["لا", "ما", "لم", "لن", "ليس", "غير"].includes(unit.normWords[firstIsl.qStart - 1]))
          ) {
            continue;
          }

          const isCompleteShortAyah = (
            unit.sourceType === "QURAN" &&
            totalMatched >= unit.normWords.length &&
            (unit.normWords.length >= 2 || isMuqattaatUnit)
          );

          if (isAdhkar) {
            const adhkarCov = totalMatched / Math.max(1, unit.normWords.length);
            if (totalMatched < 4 && adhkarCov < 0.75) continue;
            if (adhkarCov < 0.50 && totalMatched < 6) continue;
            if (dpScore[endIdx] < 8.5 && adhkarCov < 0.70) continue;
            let nonHonorificWords = 0;
            for (const isl of chainIslands) {
              for (let k = isl.tStart; k < isl.tEnd; k++) {
                if (!isCitationOrIsnadWord(tNorms[k]) && !isLowSpecWord(tNorms[k])) nonHonorificWords++;
              }
            }
            if (nonHonorificWords < 2) continue;
            // If explicitly cued as Quran ("قال تعالى"), let Quran take it instead of Adhkar
            if (this._hasCitationCue(tNorms, firstIsl.tStart, "QURAN", lastIslPre.tEnd)) continue;
          } else if (isHadith) {
            if (totalMatched < 3 || totalContent < 2) continue;
            const preTwo = tNorms.slice(Math.max(0, firstIsl.tStart - 2), firstIsl.tStart).join(" ");
            let hasNasab = false;
            for (let k = firstIsl.tStart; k < lastIslPre.tEnd; k++) {
              if (["بن", "ابن", "ابو", "ابي"].includes(tNorms[k])) { hasNasab = true; break; }
            }
            if ((preTwo === "الباب عن" || preTwo.endsWith("حدثنا") || preTwo.endsWith("اخبرنا") || hasNasab) && totalContent < 4) {
              continue;
            }
            if (!hasCue) {
              if (
                totalContent < this.minHadithContentWords ||
                totalMatched < 4 ||
                dpScore[endIdx] < this.uncuedHadithThreshold
              ) {
                continue;
              }
            }
          } else if (!isCompleteShortAyah) {
            const verseCov = totalMatched / Math.max(1, unit.normWords.length);
            // Claude Blocker #5 Fix: Reject partial Quran matches (< 55% of verse) when preceded by an explicit HADITH cue
            // or followed by a famous Hadith apodosis ('فليقل خيرا أو ليصمت', 'فليكرم جاره', 'فليصل رحمه')
            const hasExplicitHadithCue = this._hasCitationCue(tNorms, firstIsl.tStart, "HADITH", lastIslPre.tEnd);
            if (hasExplicitHadithCue && !hasCue && verseCov < 0.55) continue;
            const postTok = lastIslPre.tEnd < tNorms.length ? tNorms[lastIslPre.tEnd] : "";
            if (totalMatched <= 6 && verseCov < 0.45 && ["فليقل", "فليكرم", "فليصل", "فليحذر"].includes(postTok)) {
              continue;
            }

            // Claude Blocker #3 Fix: Prevent 2-4 word chance matches on shuffled prose
            const isLemmaPrefix = (firstIsl.qStart === 0 && totalMatched >= 4 && totalContent >= 2 && !hasFuzzyHeal && dpScore[endIdx] >= 11.5);
            if (totalContent < 2) continue;
            if (!hasCue) {
              if (totalMatched <= 2) continue;
              if (totalMatched === 3 && (totalContent < 3 || hasFuzzyHeal || dpScore[endIdx] < 16.5)) continue;
              if (totalMatched === 4 && !isLemmaPrefix && (totalContent < 3 || hasFuzzyHeal || dpScore[endIdx] < 15.5)) continue;
            } else {
              if (totalMatched <= 2 && dpScore[endIdx] < 13.5) continue;
              if (totalContent === 2 && totalMatched < 4 && dpScore[endIdx] < 13.5) continue;
            }

            let hasExegBridge = false;
            for (let k = 0; k < chainIslands.length - 1; k++) {
              const gSlice = tNorms.slice(chainIslands[k].tEnd, chainIslands[k + 1].tStart).slice(0, 2);
              if (gSlice.some(w => EXEGETICAL_MARKERS.has(w))) { hasExegBridge = true; break; }
            }
            const preWin = tNorms.slice(Math.max(0, firstIsl.tStart - 5), firstIsl.tStart);
            const isParaphraseCtx = preWin.some(w => ["اشتري", "استبدل", "يتلي", "بان", "بعض"].includes(w));
            const avgWordIdf = dpScore[endIdx] / Math.max(1, totalMatched);
            const isContiguousBoundaryClause = (
              chainIslands.length === 1 &&
              totalContent >= 3 &&
              !hasFuzzyHeal &&
              dpScore[endIdx] >= 14.5 &&
              (totalMatched >= 7 || (totalMatched >= 6 && (firstIsl.qStart === 0 || lastIslPre.qEnd === unit.normWords.length)))
            );
            if (!hasCue && verseCov < this.uncuedQuranCoverage && totalMatched < 10 && !hasExegBridge) {
              if (isParaphraseCtx || (!isContiguousBoundaryClause && !isLemmaPrefix && (totalContent < 4 || avgWordIdf < 7.0 || (totalMatched <= 4 && hasFuzzyHeal)))) {
                continue;
              }
            }
          } else if (!hasCue && !isMuqattaatUnit) {
            // Complete short ayah (2-4 words) WITHOUT a citation cue: require exact match (no fuzzy heal) and high specificity
            // so 2-3 word verses don't trigger on shuffled prose unless part of a multi-ayah recitation
            if (totalMatched <= 2 && dpScore[endIdx] < 18.0) continue;
            if (totalMatched <= 4 && (hasFuzzyHeal || totalContent < 2 || dpScore[endIdx] < 14.0)) continue;
          }

          chainIndices.forEach(idx => usedIndices.add(idx));
          const lastIsl = chainIslands[chainIslands.length - 1];
          const score = dpScore[endIdx];

          // Claude Blocker #2 Fix: Tighten VERIFIED criteria so a citation cue + 1 weak word doesn't auto-verify
          let band = "CANDIDATE";
          if (unit.sourceType === "ADHKAR") {
            band = "VERIFIED";
          } else if (unit.sourceType === "QURAN") {
            if (isMuqattaatUnit) {
              band = hasCue ? "VERIFIED" : "CANDIDATE";
            } else if (
              score >= this.verifiedThreshold &&
              (totalMatched >= 4 || isCompleteShortAyah || (hasCue && totalMatched >= 3 && totalContent >= 2))
            ) {
              band = "VERIFIED";
            } else if (hasCue && isCompleteShortAyah && score >= 9.5) {
              band = "VERIFIED";
            } else if (hasCue && totalMatched >= 3 && totalContent >= 2 && score >= 12.0) {
              band = "VERIFIED";
            }
          }

          const segments = [];
          const qSegments = [];
          const canonicalSegments = [];
          const commentaryGaps = [];

          let chainQiraah = "hafs";
          const combinedVocOverrides = {};
          for (const isl of chainIslands) {
            if (isl.detectedQiraah && isl.detectedQiraah !== "hafs" && chainQiraah === "hafs") {
              chainQiraah = isl.detectedQiraah;
            }
            if (isl.vocalizedOverrides) Object.assign(combinedVocOverrides, isl.vocalizedOverrides);
          }
          const buildCanonSlice = (qs, qe) => {
            const arr = [];
            for (let k = qs; k < qe; k++) arr.push(combinedVocOverrides[k] || unit.vocalizedWords[k]);
            return arr.join(" ");
          };

          for (const isl of chainIslands) {
            const canonPiece = buildCanonSlice(isl.qStart, isl.qEnd);
            if (segments.length === 0) {
              segments.push([isl.tStart, isl.tEnd]);
              qSegments.push([isl.qStart, isl.qEnd]);
              canonicalSegments.push(canonPiece);
            } else {
              const prevTS = segments[segments.length - 1][0];
              const prevTE = segments[segments.length - 1][1];
              const prevQS = qSegments[qSegments.length - 1][0];
              const prevQE = qSegments[qSegments.length - 1][1];
              const gapToks = tNorms.slice(prevTE, isl.tStart);
              const hasExeg = gapToks.length > 0 && gapToks.slice(0, 2).some(w => EXEGETICAL_MARKERS.has(w));
              const dTSeg = isl.tStart - prevTE;
              const dQSeg = isl.qStart - prevQE;
              if (isl.tStart === prevTE || (!hasExeg && dTSeg >= 0 && dTSeg <= 2 && dQSeg >= 0 && dQSeg <= 2)) {
                segments[segments.length - 1] = [prevTS, isl.tEnd];
                qSegments[qSegments.length - 1] = [prevQS, isl.qEnd];
                canonicalSegments[canonicalSegments.length - 1] = buildCanonSlice(prevQS, isl.qEnd);
                if (isl.tStart > prevTE) hasFuzzyHeal = true;
              } else {
                commentaryGaps.push([prevTE, isl.tStart]);
                segments.push([isl.tStart, isl.tEnd]);
                qSegments.push([isl.qStart, isl.qEnd]);
                canonicalSegments.push(canonPiece);
              }
            }
          }

          const defQ = this.defaultQiraah;
          if (!isHadith && defQ !== "AUTO" && chainQiraah === "hafs") {
            chainQiraah = defQ;
          }
          const qDisp = !isHadith ? (QIRAAT_AR_NAME[chainQiraah] || "رواية حفص عن عاصم") : "";

          if (unit.isOutsideCorpus) band = "VERIFIED";
          detections.push({
            sourceType: unit.sourceType,
            unitId: uid,
            displayRef: unit.displayRef,
            candidateRefs: [unit.displayRef],
            candidateUnitIds: [uid],
            isAmbiguous: false,
            isOutsideCorpus: Boolean(unit.isOutsideCorpus),
            confidenceBand: band,
            totalScore: Math.round(score * 100) / 100,
            hasCitationCue: hasCue,
            hasFuzzyHeal,
            tStart: firstIsl.tStart,
            tEnd: lastIsl.tEnd,
            charStart: 0,
            charEnd: 0,
            segments,
            qSegments,
            canonicalSegments,
            commentaryGaps,
            qiraah: !isHadith ? chainQiraah : "",
            qiraahDisplay: qDisp
          });
        }

        return detections;
      }

      detect(transcript) {
        const tokens = tokenizeText(transcript);
        if (tokens.length < 2) return [];
        const tNorms = tokens.map(t => t.norm);
        const islandsByUnit = this._seedAndExpandIslands(tokens);

        const allCandidates = [];
        for (const [uid, unitIslands] of islandsByUnit.entries()) {
          try {
            allCandidates.push(...this._chainIslandsForUnit(uid, unitIslands, tNorms));
          } catch (chainErr) {
            continue;
          }
        }

        // Contextual Surah-Name Disambiguation: if speaker names the Surah in the 18 tokens before the quote ('في سورة البقرة', 'في مطلع سورة النمل', 'في سورة الحجرات')
        const surahDisambiguatedSet = new Set();
        for (const det of allCandidates) {
          if (det.sourceType !== "QURAN") continue;
          const u = this.units.get(det.unitId);
          if (!u) continue;
          const ctxWin = tNorms.slice(Math.max(0, det.tStart - 16), det.tStart);
          for (let k = 0; k < ctxWin.length; k++) {
            if ((ctxWin[k] === "سوره" || stripProclitic(ctxWin[k]) === "سوره") && k + 1 < ctxWin.length) {
              const sCand = SURAH_NAME_TO_NUM[ctxWin[k + 1]];
              if (sCand && sCand === u.surah) {
                det.totalScore = Math.round((det.totalScore + 2.5) * 100) / 100;
                surahDisambiguatedSet.add(det);
                break;
              }
            }
          }
        }

        // Sequential Multi-Ayah Continuity Bonus BEFORE span deduplication
        const quranCands = allCandidates.filter(d => d.sourceType === "QURAN" && this.units.has(d.unitId));
        const boostedSet = new Set();
        for (const c1 of quranCands) {
          const u1 = this.units.get(c1.unitId);
          for (const c2 of quranCands) {
            if (c1 === c2) continue;
            const u2 = self_u2(this.units, c2.unitId);
            if (u1 && u2 && u1.surah === u2.surah && u2.ayah === u1.ayah + 1 && (c2.tStart - c1.tEnd) >= 0 && (c2.tStart - c1.tEnd) <= 3) {
              if (!boostedSet.has(c1)) {
                c1.totalScore = Math.round((c1.totalScore + 2.5) * 100) / 100;
                c1.confidenceBand = "VERIFIED";
                boostedSet.add(c1);
              }
              if (!boostedSet.has(c2)) {
                c2.totalScore = Math.round((c2.totalScore + 2.5) * 100) / 100;
                c2.confidenceBand = "VERIFIED";
                boostedSet.add(c2);
              }
            }
          }
        }
        function self_u2(unitsMap, id) { return unitsMap.get(id); }

        const verifiedStrongQuranUids = new Set();
        for (const d of allCandidates) {
          if (
            d.sourceType === "QURAN" &&
            d.confidenceBand === "VERIFIED" &&
            (d.hasCitationCue || (d.tEnd - d.tStart) >= 6 || d.totalScore >= 30.0 || boostedSet.has(d))
          ) {
            verifiedStrongQuranUids.add(d.unitId);
          }
        }

        const filteredCandidates = [];
        for (const det of allCandidates) {
          const u = this.units.get(det.unitId);
          if (u && u.sourceType === "QURAN") {
            if (u.normWords.length === 1) {
              if (!boostedSet.has(det) && !det.hasCitationCue) continue;
            }
            const matchedLen = det.segments.reduce((acc, [s, e]) => acc + (e - s), 0);
            let contentLen = 0;
            for (const [s, e] of det.segments) {
              for (let k = s; k < e; k++) {
                if (!isLowSpecWord(tNorms[k])) contentLen++;
              }
            }
            if (
              !det.hasCitationCue &&
              matchedLen < 6 &&
              contentLen < 4 &&
              matchedLen < u.normWords.length &&
              det.commentaryGaps.length === 0 &&
              !boostedSet.has(det)
            ) {
              if (!verifiedStrongQuranUids.has(det.unitId) || det.qSegments[0][0] !== 0) continue;
              det.confidenceBand = "VERIFIED";
            }
          }
          det.charStart = tokens[det.tStart].charStart;
          det.charEnd = tokens[det.tEnd - 1].charEnd;
          filteredCandidates.push(det);
        }

        const bySpanSig = new Map();
        for (const det of filteredCandidates) {
          const sig = det.segments.map(s => `${s[0]}:${s[1]}`).join("|");
          if (!bySpanSig.has(sig)) bySpanSig.set(sig, []);
          bySpanSig.get(sig).push(det);
        }

        const deduped = [];
        for (const group of bySpanSig.values()) {
          group.sort((a, b) => {
            const stRank = (d) => {
              if (d.sourceType === "ADHKAR" && !d.hasCitationCue) return 0;
              if (d.sourceType === "QURAN") return 1;
              if (d.sourceType === "ADHKAR") return 2;
              return 3;
            };
            const stA = stRank(a);
            const stB = stRank(b);
            if (stA !== stB) return stA - stB;
            if (b.totalScore !== a.totalScore) return b.totalScore - a.totalScore;
            const uA = this.units.get(a.unitId);
            const uB = this.units.get(b.unitId);
            return (uA.surah - uB.surah) || (uA.ayah - uB.ayah);
          });
          const best = group[0];
          const topScore = best.totalScore;
          const competing = [];
          const competingUids = [];
          // Claude Blocker #2 Fix: Use a 1.25 score margin for Quran ambiguity (so proclitic differences like 'وهدى وبشرى للمؤمنين' 2:97 vs 27:2 are caught as ambiguous)
          // unless the top candidate was uniquely disambiguated by sequential multi-ayah continuity or explicit Surah name in context!
          const topUniquelyDisambiguated = boostedSet.has(best) || surahDisambiguatedSet.has(best);
          const tieMargin = (best.sourceType === "QURAN" && !topUniquelyDisambiguated) ? 1.25 : 0.35;
          for (const g of group) {
            if (g.sourceType === best.sourceType && Math.abs(g.totalScore - topScore) <= tieMargin) {
              if (topUniquelyDisambiguated && g !== best && !boostedSet.has(g) && !surahDisambiguatedSet.has(g)) continue;
              if (!competing.includes(g.displayRef)) competing.push(g.displayRef);
              if (!competingUids.includes(g.unitId)) competingUids.push(g.unitId);
            }
          }
          best.candidateRefs = competing;
          best.candidateUnitIds = competingUids;
          if (competing.length > 1) {
            best.isAmbiguous = true;
            // Claude Blocker #2 Fix: Ambiguous multi-home Quran verses (e.g. Ar-Rahman refrain, standalone 27:3/31:4, standalone وهدى وبشرى للمؤمنين)
            // get their own 'AMBIGUOUS' confidenceBand showing the candidate set rather than claiming a single VERIFIED reference!
            if (best.sourceType === "QURAN" && !topUniquelyDisambiguated) {
              best.confidenceBand = "AMBIGUOUS";
            }
          }
          deduped.push(best);
        }

        

        deduped.sort((a, b) => {
          const rankNms = (d) => {
            if (d.sourceType === "QURAN" && d.confidenceBand === "VERIFIED" && d.hasCitationCue) return 0;
            if (d.sourceType === "ADHKAR" && (d.tEnd - d.tStart) >= 5) return 1;
            if (d.sourceType === "QURAN" && d.confidenceBand === "VERIFIED" && ((d.tEnd - d.tStart) >= 6 || d.totalScore >= 30.0)) return 2;
            return 3;
          };
          const pA = rankNms(a);
          const pB = rankNms(b);
          if (pA !== pB) return pA - pB;
          if (b.totalScore !== a.totalScore) return b.totalScore - a.totalScore;
          return (b.tEnd - b.tStart) - (a.tEnd - a.tStart);
        });

        let accepted = [];
        const occupied = new Set();

        for (const det of deduped) {
          let overlap = false;
          for (const [s, e] of det.segments) {
            for (let k = s; k < e; k++) {
              if (occupied.has(k)) { overlap = true; break; }
            }
            if (overlap) break;
          }
          if (!overlap) {
            accepted.push(det);
            for (const [s, e] of det.segments) {
              for (let k = s; k < e; k++) occupied.add(k);
            }
          } else if (det.sourceType === "HADITH") {
            // Claude Blocker #4 Fix: If another HADITH candidate overlaps >= 75% with an already accepted HADITH,
            // merge its reference into the accepted Hadith's candidateRefs ("possible sources")!
            let mergedIntoExisting = false;
            for (const acc of accepted) {
              if (acc.sourceType === "HADITH" && computeTokenIoU(det.segments, acc.segments) >= 0.75) {
                for (const r of (det.candidateRefs || [det.displayRef])) {
                  if (!acc.candidateRefs.includes(r)) acc.candidateRefs.push(r);
                }
                for (const u of (det.candidateUnitIds || [det.unitId])) {
                  if (!acc.candidateUnitIds.includes(u)) acc.candidateUnitIds.push(u);
                }
                if (acc.candidateRefs.length > 1) acc.isAmbiguous = true;
                mergedIntoExisting = true;
                break;
              }
            }
            if (!mergedIntoExisting && det.segments.length === 1) {
            const [s, e] = det.segments[0];
            let nonOverlapEnd = s;
            while (nonOverlapEnd < e && !occupied.has(nonOverlapEnd)) nonOverlapEnd++;
            while (
              nonOverlapEnd > s &&
              (isCitationOrIsnadWord(tNorms[nonOverlapEnd - 1]) ||
               isLowSpecWord(tNorms[nonOverlapEnd - 1]) ||
               ["مثل", "نزلت", "الايه"].includes(tNorms[nonOverlapEnd - 1]))
            ) {
              nonOverlapEnd--;
            }
            if (nonOverlapEnd - s >= 4) {
              det.tEnd = nonOverlapEnd;
              det.segments = [[s, nonOverlapEnd]];
              det.charEnd = tokens[nonOverlapEnd - 1].charEnd;
              accepted.push(det);
              for (let k = s; k < nonOverlapEnd; k++) occupied.add(k);
            }
          }
          }
        }

        accepted.sort((a, b) => a.tStart - b.tStart);

        // Suppress un-cued partial Hadith echoes when the fuller Hadith was already detected earlier in the lecture
        const fullHadithIds = new Set(accepted.filter(d => d.sourceType === "HADITH" && (d.hasCitationCue || (d.tEnd - d.tStart) >= 8)).map(d => d.unitId));
        accepted = accepted.filter(det => {
          if (det.sourceType === "HADITH" && !det.hasCitationCue && fullHadithIds.has(det.unitId)) {
            const uH = this.units.get(det.unitId);
            if (uH && (det.tEnd - det.tStart) < uH.normWords.length * 0.55) return false;
          }
          return true;
        });

        // Suppress Basmalah (1:1) when immediately preceding another Quranic verse
        accepted = accepted.filter((det, idx) => {
          if (
            det.unitId === "1:1" &&
            idx + 1 < accepted.length &&
            accepted[idx + 1].sourceType === "QURAN" &&
            (accepted[idx + 1].tStart - det.tEnd) >= 0 &&
            (accepted[idx + 1].tStart - det.tEnd) <= 1
          ) {
            return false;
          }
          return true;
        });

        for (let i = 0; i < accepted.length; i++) {
          const det = accepted[i];
          if (det.sourceType === "QURAN" && det.confidenceBand === "CANDIDATE") {
            const uCurr = this.units.get(det.unitId);
            if (!uCurr) continue;
            for (const nbIdx of [i - 1, i + 1]) {
              if (nbIdx >= 0 && nbIdx < accepted.length) {
                const nb = accepted[nbIdx];
                const uNb = this.units.get(nb.unitId);
                if (
                  nb.sourceType === "QURAN" &&
                  nb.confidenceBand === "VERIFIED" &&
                  uNb && uNb.surah === uCurr.surah &&
                  Math.abs(uNb.ayah - uCurr.ayah) === 1
                ) {
                  const gap = nbIdx < i ? (det.tStart - nb.tEnd) : (nb.tStart - det.tEnd);
                  if (gap >= 0 && gap <= 2) {
                    det.confidenceBand = "VERIFIED";
                    det.totalScore = Math.round((det.totalScore + 4.0) * 100) / 100;
                    break;
                  }
                }
              }
            }
          }
        }

        // =========================================================================
        // NESTED-VERSE PASS (display-only, AFTER NMS + echo/basmalah cleanups)
        // Find Quran-verse runs quoted INSIDE accepted single-segment HADITH
        // detections and attach them as plain metadata on det.embeddedQuran.
        // This never re-ranks anything: a verse quoted inside a hadith narration
        // keeps its HADITH identity unless the span is overwhelmingly the verse
        // AND has no citation cue (then the whole det is re-labelled QURAN).
        // =========================================================================
        for (const det of accepted) {
          if (det.sourceType !== "HADITH" || !det.segments || det.segments.length !== 1) continue;
          const [segS, segE] = det.segments[0];
          if (segE - segS < 4) continue;
          const runCands = [];
          for (let i = segS; i + 4 <= segE; i++) {
            const hits = this.bigramIndex.get(`${tNorms[i]}|${tNorms[i + 1]}`);
            if (!hits) continue;
            let best = null;
            for (const [uid, j] of hits) {
              const uQ = this.units.get(uid);
              if (!uQ || uQ.sourceType !== "QURAN") continue;
              let len = 0;
              while (
                i + len < segE && j + len < uQ.normWords.length &&
                wordMatchQuality(tNorms[i + len], uQ.normWords[j + len], uid, uQ.vocalizedWords[j + len]) >= 0.95
              ) {
                len++;
              }
              if (len >= 4 && (!best || len > best.len)) best = { uid, j, len };
            }
            if (best) runCands.push({ i, ...best });
          }
          if (!runCands.length) continue;
          runCands.sort((a, b) => (b.len - a.len) || (a.i - b.i));
          const keptRuns = [];
          for (const c of runCands) {
            if (keptRuns.some(k => c.i < k.i + k.len && k.i < c.i + c.len)) continue;
            keptRuns.push(c);
          }
          if (!keptRuns.length) continue;
          det.embeddedQuran = keptRuns.map(c => {
            const uQ = this.units.get(c.uid);
            return {
              tStart: c.i,
              tEnd: c.i + c.len,
              qStart: c.j,
              qEnd: c.j + c.len,
              unitId: c.uid,
              displayRef: uQ.displayRef,
              canonical: uQ.vocalizedWords.slice(c.j, c.j + c.len).join(" ")
            };
          });
          const spanLen = segE - segS;
          const bestRun = keptRuns[0];
          if (bestRun.len / spanLen >= 0.8 && !det.hasCitationCue) {
            const uQ = this.units.get(bestRun.uid);
            det.sourceType = "QURAN";
            det.unitId = bestRun.uid;
            det.displayRef = uQ.displayRef;
            det.confidenceBand = "CANDIDATE";
            try {
              recomputeCanonicalForDetection(det, tokens, this);
            } catch (e) { /* keep hadith-aligned canonical as fallback */ }
          }
        }

        return accepted;
      }

    }

    // =========================================================================
    // 5. WAHY-FINDER v2.0: WORD-LEVEL TIMESTAMP MAPPING & SUBTITLE PARSERS
    // =========================================================================

    function sourceTypeToCategorySlug(sourceType) {
      if (sourceType === "QURAN") return "ayah";
      if (sourceType === "HADITH") return "hadith";
      if (sourceType === "ADHKAR") return "dhikr";
      return "ayah";
    }

    function categorySlugToSourceType(slug) {
      if (slug === "ayah" || slug === "QURAN") return "QURAN";
      if (slug === "hadith" || slug === "HADITH") return "HADITH";
      if (slug === "dhikr" || slug === "ADHKAR") return "ADHKAR";
      return "QURAN";
    }

    /**
     * Synthesize word-level timestamps when input is plain text (.txt or direct paste)
     * so the Smart Caption Builder and Caption Editor work identically on text fast-path.
     */
    function synthesizeWordsFromRawText(rawText) {
      const text = String(rawText || "");
      const words = [];
      const wsRe = /\S+/g;
      let m;
      let currentTime = 0.0;
      let id = 0;

      while ((m = wsRe.exec(text)) !== null) {
        const w = m[0];
        const charStart = m.index;
        const charEnd = m.index + w.length;
        // Estimate duration based on Arabic word length (~0.28s to 0.52s per word)
        const dur = Math.min(0.65, Math.max(0.24, w.length * 0.065));
        const start = Number(currentTime.toFixed(2));
        const end = Number((currentTime + dur).toFixed(2));

        words.push({
          id: id++,
          word: w,
          start,
          end,
          char_start: charStart,
          char_end: charEnd
        });

        // Add natural pause after punctuation or line breaks
        const trailingSlice = text.slice(charEnd, Math.min(text.length, charEnd + 4));
        let pause = 0.04;
        if (/[\n\r]/.test(trailingSlice)) pause = 0.55;
        else if (/[.؟!؛:]/.test(w)) pause = 0.48;
        else if (/[،,]/.test(w)) pause = 0.36;

        currentTime = end + pause;
      }
      return words;
    }

    /**
     * Parse .SRT or .VTT subtitle text into { full_text, words } with word-level timestamps.
     */
    function parseSubtitleFileToWords(subtitleContent) {
      const lines = String(subtitleContent || "").replace(/\r\n/g, "\n").split("\n");
      const timeRe = /(\d{1,2}:)?(\d{2}):(\d{2})[.,](\d{3})\s*-->\s*(\d{1,2}:)?(\d{2}):(\d{2})[.,](\d{3})/;
      const cues = [];
      let i = 0;

      function parseTimeParts(h, m, s, ms) {
        const hh = h ? parseInt(h.replace(":", ""), 10) : 0;
        return hh * 3600 + parseInt(m, 10) * 60 + parseInt(s, 10) + parseInt(ms, 10) / 1000.0;
      }

      while (i < lines.length) {
        const line = lines[i].trim();
        const tm = timeRe.exec(line);
        if (tm) {
          const startSec = parseTimeParts(tm[1], tm[2], tm[3], tm[4]);
          const endSec = parseTimeParts(tm[5], tm[6], tm[7], tm[8]);
          i++;
          const textLines = [];
          while (i < lines.length && lines[i].trim() !== "") {
            const cleaned = lines[i]
              .replace(/<[^>]+>/g, "")
              .replace(/\{[^}]+\}/g, "")
              .trim();
            if (cleaned) textLines.push(cleaned);
            i++;
          }
          const cueText = textLines.join(" ").trim();
          if (cueText) {
            cues.push({ start: startSec, end: Math.max(startSec + 0.2, endSec), text: cueText });
          }
        } else {
          i++;
        }
      }

      if (!cues.length) {
        const cleanRaw = String(subtitleContent || "").trim();
        return {
          full_text: cleanRaw,
          words: synthesizeWordsFromRawText(cleanRaw)
        };
      }

      const words = [];
      const textParts = [];
      let charCursor = 0;

      for (const cue of cues) {
        const rawWords = cue.text.split(/\s+/).filter(Boolean);
        if (!rawWords.length) continue;
        const step = (cue.end - cue.start) / rawWords.length;
        rawWords.forEach((rw, idx) => {
          const wStart = Number((cue.start + idx * step).toFixed(2));
          const wEnd = Number((cue.start + (idx + 1) * step).toFixed(2));
          const cStart = charCursor;
          const cEnd = cStart + rw.length;
          words.push({
            id: words.length,
            word: rw,
            start: wStart,
            end: Math.max(wStart + 0.04, wEnd),
            char_start: cStart,
            char_end: cEnd
          });
          textParts.push(rw);
          charCursor = cEnd + 1;
        });
      }

      return {
        full_text: textParts.join(" "),
        words
      };
    }

    /**
     * Map character offsets (charStart, charEnd) of every detection from QuotationMatcherJS
     * to the word-level timestamp array `words` (`{ id, word, start, end, char_start, char_end }`).
     */
    function mapDetectionsToWordTimestamps(detections, words, fullText) {
      if (!Array.isArray(detections) || !detections.length) return [];
      const wordList = (Array.isArray(words) && words.length)
        ? words
        : synthesizeWordsFromRawText(fullText || "");

      if (!wordList.length) return detections;

      return detections.map((det, idx) => {
        const cStart = typeof det.charStart === "number" ? det.charStart : (det.startIndex ?? 0);
        const cEnd = typeof det.charEnd === "number" ? det.charEnd : (det.endIndex ?? cStart);

        // Find first word overlapping or starting at/after cStart
        let wStartIdx = 0;
        for (let i = 0; i < wordList.length; i++) {
          if (wordList[i].char_end > cStart) {
            wStartIdx = i;
            break;
          }
        }

        // Find last word overlapping or ending at/before cEnd
        let wEndIdx = wStartIdx;
        for (let i = wStartIdx; i < wordList.length; i++) {
          if (wordList[i].char_start < cEnd) {
            wEndIdx = i;
          } else {
            break;
          }
        }

        const firstWord = wordList[wStartIdx] || wordList[0];
        const lastWord = wordList[wEndIdx] || firstWord;

        const exactCharStart = firstWord ? firstWord.char_start : cStart;
        const exactCharEnd = lastWord ? lastWord.char_end : cEnd;
        const matchedText = fullText
          ? fullText.slice(exactCharStart, exactCharEnd)
          : wordList.slice(wStartIdx, wEndIdx + 1).map(w => w.word).join(" ");

        const canonicalText = (Array.isArray(det.canonicalSegments) && det.canonicalSegments.length)
          ? det.canonicalSegments.join(" ")
          : (det.canonicalText || matchedText);

        // Enrich detection in-place and return it (preserving all existing fields + v2.0 schema)
        det.id = det.id || `finding_${idx + 1}`;
        det.type = sourceTypeToCategorySlug(det.sourceType);
        det.startIndex = exactCharStart;
        det.endIndex = exactCharEnd;
        det.charStart = exactCharStart;
        det.charEnd = exactCharEnd;
        det.wordStartIdx = wStartIdx;
        det.wordEndIdx = wEndIdx;
        det.startTime = firstWord ? Number(firstWord.start) : 0.0;
        det.endTime = lastWord ? Number(lastWord.end) : 0.0;
        det.matchedText = matchedText;
        det.canonicalText = canonicalText;
        det.reference = det.displayRef || det.reference || "";
        det.confidence = det.confidenceBand === "VERIFIED" ? 0.98 : (det.confidenceBand === "AMBIGUOUS" ? 0.82 : 0.72);
        if (typeof det.snappedToCanonical !== "boolean") {
          det.snappedToCanonical = false;
        }
        return det;
      });
    }

    // =========================================================================
    // From js/state.js and js/editor.js: re-align a finding's canonical words after the v3 engine moves it
    // from a hadith to the verse quoted inside it. The matcher is an argument (it was a global).
    // =========================================================================
function alignTranscriptSegToUnit(tNorms, s, e, unit, hintQS = null, matcher) {
  const qWords = unit.normWords;
  const qLen = qWords.length;
  const segLen = Math.max(1, e - s);
  if (qLen === 0) return [0, 0];

  let bestQS = 0;
  let bestQE = Math.min(qLen, segLen);
  let bestScore = -1e9;

  for (let qs = 0; qs < qLen; qs++) {
    let score = 0;
    let ti = s;
    let qi = qs;
    let matchedToks = 0;

    while (ti < e && qi < qLen) {
      const tw = tNorms[ti];
      const qw = qWords[qi];

      if (ti + 1 < e && isFusedTwoToOneMatch(tw, tNorms[ti + 1], qw)) {
        score += 1.4 * matcher.getIdf(qw);
        matchedToks += 2;
        ti += 2;
        qi += 1;
        continue;
      }
      if (qi + 1 < qLen && isFusedTwoToOneMatch(qw, qWords[qi + 1], tw)) {
        score += 1.4 * matcher.getIdf(qw);
        matchedToks += 1;
        ti += 1;
        qi += 2;
        continue;
      }
      const qv = wordMatchQuality(tw, qw, unit.sourceType === "QURAN" ? unit.unitId : "", unit.vocalizedWords[qi]);
      if (qv > 0) {
        score += qv * matcher.getIdf(qw);
        matchedToks += 1;
        ti += 1;
        qi += 1;
        continue;
      }
      if (ti + 1 < e && wordMatchQuality(tNorms[ti + 1], qw, unit.sourceType === "QURAN" ? unit.unitId : "", unit.vocalizedWords[qi]) >= 0.85) {
        ti += 1;
        continue;
      }
      if (qi + 1 < qLen && wordMatchQuality(tw, qWords[qi + 1], unit.sourceType === "QURAN" ? unit.unitId : "", unit.vocalizedWords[qi + 1]) >= 0.85) {
        qi += 1;
        continue;
      }
      score -= 0.35;
      ti += 1;
      qi += 1;
    }

    if (ti < e) score -= (e - ti) * 2.5;
    if (hintQS !== null && !isNaN(hintQS)) score -= Math.abs(qs - hintQS) * 0.15;

    const candQE = Math.max(qs + 1, Math.min(qLen, qi));
    if (matchedToks > 0 && score > bestScore) {
      bestScore = score;
      bestQS = qs;
      bestQE = candQE;
    }
  }
  return [bestQS, bestQE];
}

function recomputeCanonicalForDetection(det, rawTokens, matcher) {
  if (!rawTokens || !rawTokens.length || !det.segments || !det.segments.length) return;
  det.tStart = Math.max(0, Math.min(rawTokens.length - 1, det.segments[0][0]));
  det.tEnd = Math.max(det.tStart + 1, Math.min(rawTokens.length, det.segments[det.segments.length - 1][1]));
  det.charStart = rawTokens[det.tStart].charStart;
  det.charEnd = rawTokens[det.tEnd - 1].charEnd;

  const unit = matcher && matcher.units ? matcher.units.get(det.unitId) : null;
  if (!unit || det.unitId === "OUTSIDE_CORPUS" || det.isOutsideCorpus) {
    det.qSegments = det.segments.map(([s, e]) => [0, Math.max(1, e - s)]);
    det.canonicalSegments = det.segments.map(([s, e]) => rawTokens.slice(s, e).map(t => t.raw).join(" "));
    det.canonicalText = det.canonicalSegments.join(" ");
    return;
  }
  const tNorms = rawTokens.map(t => t.norm);
  // Hadith: align against the full text (chain of narration + matn + takhrij), so spoken words that belong to
  // the chain (e.g. after extending the start by hand) are matched and kept, not just the matn the engine compares.
  const view = typeof getUnitFullWordView === "function" ? getUnitFullWordView(unit) : null;
  const target = view ? fullTextAlignmentUnit(unit, view) : unit;
  const off = view ? view.matnStart : 0;
  const matnLen = unit.vocalizedWords.length;
  const fullSegs = [];
  const newCanonSegs = [];
  for (let idx = 0; idx < det.segments.length; idx++) {
    const [s, e] = det.segments[idx];
    const prevHint = det.qFullSegments?.[idx]?.[0] ?? (det.qSegments?.[idx] ? det.qSegments[idx][0] + off : null);
    const [bestQS, bestQE] = alignTranscriptSegToUnit(tNorms, s, e, target, prevHint, matcher);
    fullSegs.push([bestQS, bestQE]);
    newCanonSegs.push(target.vocalizedWords.slice(bestQS, bestQE).join(" "));
  }
  // qSegments stay in matn positions for the rest of the app (clamped to the matn)
  det.qSegments = fullSegs.map(([a, b]) => [Math.max(0, Math.min(matnLen, a - off)), Math.max(0, Math.min(matnLen, b - off))]);
  det.qFullSegments = view ? fullSegs : undefined;
  det.refSelection = undefined;   // the span changed: the manual word choice no longer applies
  det.canonicalSegments = newCanonSegs;
  det.canonicalText = newCanonSegs.join(" ");
}

function getUnitFullWordView(unit) {
  if (!unit) return null;
  if (unit._fullView !== undefined) return unit._fullView;
  let view = null;
  const matn = unit.vocalizedWords || [];
  if (unit.sourceType === "HADITH" && unit.fullText && matn.length && typeof tokenizeText === "function") {
    const expanded = typeof expandHonorificLigatures === "function" ? expandHonorificLigatures(unit.fullText) : unit.fullText;
    const full = tokenizeText(expanded);
    const norm = w => (typeof normalizeArabic === "function" ? normalizeArabic(w) : w);
    const mNorm = matn.map(norm);
    const probe = Math.min(4, mNorm.length);
    for (let k = 0; k + probe <= full.length; k++) {
      let ok = true;
      for (let i = 0; i < probe; i++) {
        if (full[k + i].norm !== mNorm[i]) { ok = false; break; }
      }
      if (ok) {
        view = { words: full.map(t => t.raw), norms: full.map(t => t.norm), matnStart: k, matnEnd: Math.min(full.length, k + mNorm.length) };
        break;
      }
    }
    if (view && view.matnStart === 0 && view.matnEnd >= view.words.length) view = null; // nothing outside the matn
  }
  unit._fullView = view;
  return view;
}

function fullTextAlignmentUnit(unit, view) {
  return { sourceType: unit.sourceType, unitId: unit.unitId, normWords: view.norms, vocalizedWords: view.words };
}

export {
  QuotationMatcherJS, mapDetectionsToWordTimestamps, synthesizeWordsFromRawText, parseSubtitleFileToWords,
  sourceTypeToCategorySlug, categorySlugToSourceType,
  // used by engines v4 and v5
  WORD_TOKEN_RE, MUQATTAAT_WORDS, QUARANTINED_FORMULAS, QIRAAT_AR_NAME, QIRAAT_PRIORITY_RANK, QIRAAT_FARSH_VARIANTS,
  expandHonorificLigatures, normalizeArabic, isFusedTwoToOneMatch, stripProclitic, isLowSpecWord, tokenizeText,
  levenshteinLe1, matchWordWithQiraat, stripIsnad,
  // used by expand.ts (the old editor's boundary heal)
  wordMatchQuality, isCitationOrIsnadWord, recomputeCanonicalForDetection,
};
