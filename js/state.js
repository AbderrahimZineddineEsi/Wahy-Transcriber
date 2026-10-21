// =============================================================================
// Wahy Studio (Wahy-Transcriber v2.1) — State Store, Built-in Adhkar Seed & Persistence
// File: js/state.js
// =============================================================================

const SURAH_NAMES_AR = {
  "1": "الفاتحة", "2": "البقرة", "3": "آل عمران", "4": "النساء", "5": "المائدة", "6": "الأنعام",
  "7": "الأعراف", "8": "الأنفال", "9": "التوبة", "10": "يونس", "11": "هود", "12": "يوسف",
  "13": "الرعد", "14": "إبراهيم", "15": "الحجر", "16": "النحل", "17": "الإسراء", "18": "الكهف",
  "19": "مريم", "20": "طه", "21": "الأنبياء", "22": "الحج", "23": "المؤمنون", "24": "النور",
  "25": "الفرقان", "26": "الشعراء", "27": "النمل", "28": "القصص", "29": "العنكبوت", "30": "الروم",
  "31": "لقمان", "32": "السجدة", "33": "الأحزاب", "34": "سبأ", "35": "فاطر", "36": "يس",
  "37": "الصافات", "38": "ص", "39": "الزمر", "40": "غافر", "41": "فصلت", "42": "الشورى",
  "43": "الزخرف", "44": "الدخان", "45": "الجاثية", "46": "الأحقاف", "47": "محمد", "48": "الفتح",
  "49": "الحجرات", "50": "ق", "51": "الذاريات", "52": "الطور", "53": "النجم", "54": "القمر",
  "55": "الرحمن", "56": "الواقعة", "57": "الحديد", "58": "المجادلة", "59": "الحشر", "60": "الممتحنة",
  "61": "الصف", "62": "الجمعة", "63": "المنافقون", "64": "التغابن", "65": "الطلاق", "66": "التحريم",
  "67": "الملك", "68": "القلم", "69": "الحاقة", "70": "المعارج", "71": "نوح", "72": "الجن",
  "73": "المزمل", "74": "المدثر", "75": "القيامة", "76": "الإنسان", "77": "المرسلات", "78": "النبأ",
  "79": "النازعات", "80": "عبس", "81": "التكوير", "82": "الانفطار", "83": "المطففين", "84": "الانشقاق",
  "85": "البروج", "86": "الطارق", "87": "الأعلى", "88": "الغاشية", "89": "الفجر", "90": "البلد",
  "91": "الشمس", "92": "الليل", "93": "الضحى", "94": "الشرح", "95": "التين", "96": "العلق",
  "97": "القدر", "98": "البينة", "99": "الزلزلة", "100": "العاديات", "101": "القارعة", "102": "التكاثر",
  "103": "العصر", "104": "الهمزة", "105": "الفيل", "106": "قريش", "107": "الماعون", "108": "الكوثر",
  "109": "الكافرون", "110": "النصر", "111": "المسد", "112": "الإخلاص", "113": "الفلق", "114": "الناس"
};

const SURAH_NAME_TO_NUM = {};
function rebuildSurahNameLookup() {
  Object.entries(SURAH_NAMES_AR).forEach(([num, name]) => {
    SURAH_NAME_TO_NUM[name] = parseInt(num, 10);
    const norm = name.replace(/[أإآٱ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي");
    SURAH_NAME_TO_NUM[norm] = parseInt(num, 10);
  });
}
rebuildSurahNameLookup();

// Built-in adhkar: only the best-known short adhkar. Longer du'as and collections are added by the user in the
// Adhkar studio (their additions are marked isCustom and kept across updates).
const BUILTIN_ADHKAR_DATA = [
  { id: "Adhkar:tahlil", category: "التهليل", ref: "التهليل", t: "لَا إِلَٰهَ إِلَّا اللَّهُ" },
  { id: "Adhkar:tahlil_full", category: "التهليل", ref: "التهليل الجامع", t: "لَا إِلَٰهَ إِلَّا اللَّهُ وَحْدَهُ لَا شَرِيكَ لَهُ لَهُ الْمُلْكُ وَلَهُ الْحَمْدُ وَهُوَ عَلَىٰ كُلِّ شَيْءٍ قَدِيرٌ" },
  { id: "Adhkar:tasbih", category: "التسبيح", ref: "التسبيح", t: "سُبْحَانَ اللَّهِ" },
  { id: "Adhkar:tasbih_hamd", category: "التسبيح", ref: "التسبيح والتحميد", t: "سُبْحَانَ اللَّهِ وَبِحَمْدِهِ" },
  { id: "Adhkar:tasbih_azim", category: "التسبيح", ref: "التسبيح", t: "سُبْحَانَ اللَّهِ الْعَظِيمِ" },
  { id: "Adhkar:kalimatan", category: "التسبيح", ref: "كلمتان حبيبتان إلى الرحمن", t: "سُبْحَانَ اللَّهِ وَبِحَمْدِهِ سُبْحَانَ اللَّهِ الْعَظِيمِ" },
  { id: "Adhkar:tahmid", category: "التحميد", ref: "التحميد", t: "الْحَمْدُ لِلَّهِ" },
  { id: "Adhkar:takbir", category: "التكبير", ref: "التكبير", t: "اللَّهُ أَكْبَرُ" },
  { id: "Adhkar:baqiyat", category: "الباقيات الصالحات", ref: "الباقيات الصالحات", t: "سُبْحَانَ اللَّهِ وَالْحَمْدُ لِلَّهِ وَلَا إِلَٰهَ إِلَّا اللَّهُ وَاللَّهُ أَكْبَرُ" },
  { id: "Adhkar:hawqala", category: "الحوقلة", ref: "الحوقلة", t: "لَا حَوْلَ وَلَا قُوَّةَ إِلَّا بِاللَّهِ" },
  { id: "Adhkar:istighfar", category: "الاستغفار", ref: "الاستغفار", t: "أَسْتَغْفِرُ اللَّهَ" },
  { id: "Adhkar:istighfar_tawba", category: "الاستغفار", ref: "الاستغفار والتوبة", t: "أَسْتَغْفِرُ اللَّهَ وَأَتُوبُ إِلَيْهِ" },
  { id: "Adhkar:basmala", category: "البسملة", ref: "البسملة", t: "بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ" },
  { id: "Adhkar:istiadha", category: "الاستعاذة", ref: "الاستعاذة", t: "أَعُوذُ بِاللَّهِ مِنَ الشَّيْطَانِ الرَّجِيمِ" },
  { id: "Adhkar:hasbala", category: "الحسبلة", ref: "الحسبلة", t: "حَسْبُنَا اللَّهُ وَنِعْمَ الْوَكِيلُ" },
  { id: "Adhkar:istirja", category: "الاسترجاع", ref: "الاسترجاع", t: "إِنَّا لِلَّهِ وَإِنَّا إِلَيْهِ رَاجِعُونَ" },
  { id: "Adhkar:salat_nabi", category: "الصلاة على النبي", ref: "الصلاة على النبي ﷺ", t: "اللَّهُمَّ صَلِّ وَسَلِّمْ عَلَىٰ نَبِيِّنَا مُحَمَّدٍ" },
  { id: "Adhkar:mashallah", category: "أذكار متفرقة", ref: "ما شاء الله", t: "مَا شَاءَ اللَّهُ لَا قُوَّةَ إِلَّا بِاللَّهِ" }
];

let RAW_QURAN_DATA = [];
let RAW_HADITH_DATA = [];
let RAW_ADHKAR_DATA = BUILTIN_ADHKAR_DATA.map(x => ({ ...x }));
let RAW_OUTSIDE_HADITH_DATA = [];
const PRESET_LECTURES = {};

const LS_CUSTOM_ADHKAR_KEY = "wahyTranscriber_adhkarDataset_v22";
const LS_CUSTOM_ADHKAR_KEY_V21 = "wahyTranscriber_adhkarDataset_v21"; // held built-ins + 300+ downloaded adhkar
const LS_OUTSIDE_HADITH_KEY = "wahyTranscriber_outsideHadith_v21";
const LS_OUTPUT_PREFS_KEY = "wahyTranscriber_outputPrefs_v21";

const DATASET_CATALOG = [
  { key: "Nawawi40", title: "الأربعون النووية (Imam Nawawi)", estTotal: 42, url: "https://cdn.jsdelivr.net/gh/fawazahmed0/hadith-api@1/editions/ara-nawawi.min.json", enabled: true },
  { key: "Qudsi40", title: "الأربعون القدسية (Hadith Qudsi)", estTotal: 40, url: "https://cdn.jsdelivr.net/gh/fawazahmed0/hadith-api@1/editions/ara-qudsi.min.json", enabled: true },
  { key: "RiyadSalihin", title: "رياض الصالحين (Riyad as-Salihin)", estTotal: 1896, url: "https://raw.githubusercontent.com/AhmedBaset/hadith-json/v1.2.0/db/by_book/other_books/riyad_assalihin.json", enabled: true },
  { key: "BulughMaram", title: "بلوغ المرام (Bulugh al-Maram)", estTotal: 1568, url: "https://raw.githubusercontent.com/AhmedBaset/hadith-json/v1.2.0/db/by_book/other_books/bulugh_almaram.json", enabled: true },
  { key: "Bukhari", title: "صحيح البخاري (Sahih al-Bukhari)", estTotal: 7563, url: "https://cdn.jsdelivr.net/gh/fawazahmed0/hadith-api@1/editions/ara-bukhari.min.json", enabled: true },
  { key: "Muslim", title: "صحيح مسلم (Sahih Muslim)", estTotal: 7563, url: "https://cdn.jsdelivr.net/gh/fawazahmed0/hadith-api@1/editions/ara-muslim.min.json", enabled: true },
  { key: "AbiDawud", title: "سنن أبي داود (Sunan Abi Dawud)", estTotal: 5274, url: "https://cdn.jsdelivr.net/gh/fawazahmed0/hadith-api@1/editions/ara-abudawud.min.json", enabled: true },
  { key: "Tirmidhi", title: "جامع الترمذي (Jami` at-Tirmidhi)", estTotal: 3956, url: "https://cdn.jsdelivr.net/gh/fawazahmed0/hadith-api@1/editions/ara-tirmidhi.min.json", enabled: true }
];

let activeMatcher = null;
let demoPlaybackTimer = null;

let currentState = {
  version: "2.1.0",
  activeSection: "display",       // "input" | "display" | "editor" | "datasets"
  editorSubMode: "fn_studio",     // "fn_studio" | "text_edit" | "captions_edit"
  editorDockTab: "fn",            // "fn" | "inspector"
  fnSelectMode: true,
  fnClickStep: 0,                 // 0 = waiting for start word click, 1 = start clicked (hover preview active)
  adhkarEnabled: true,
  outsideCorpusEnabled: true,
  corpus: {
    ayat: [],
    hadiths: [],
    adhkar: RAW_ADHKAR_DATA,
    loadedAt: null
  },
  inputType: "text",              // "youtube" | "media" | "text"
  selectedModel: "groq-whisper-large-v3-turbo",
  groqApiKey: "",
  autoFallback: true,
  lectureTitle: "محاضرة علمية — استوديو الوحيين",
  mediaUrl: "",
  mediaType: "demo",
  rawText: "",
  editorPlaybackFollowsSelection: true,
  editorViewRasmQiyasi: false,
  editorViewFullCanonicalSpan: false,
  displayFormatting: {
    showSurahNames: true,
    showHadithSources: true,
    ayahBrackets: "quranic", // "quranic" | "angle" | "parentheses" | "none"
    adhkarBrackets: "special", // "special" | "brackets" | "none"
    highlightUnverified: false
  },
  tafrighConfig: {
    mode: "per_sentence",
    model: "gemini-3.5-flash-lite",
    typoStrategy: "gated",
    scope: "full"
  },
  verificationConfig: {
    acceptThreshold: 0.75,
    ambiguityThreshold: 0.45,
    contextWindowWords: 25,
    checkCompleteness: true,
    checkCorrectness: true
  },
  rawTranscript: "",
  words: [],                      // [{ id, word, start, end, char_start, char_end }]
  detections: [],                 // Engine findings mapped to word timestamps
  captions: [],                   // Smart Citation-Aware Subtitle blocks
  selectedPredIndex: -1,
  selectedCaptionIndex: -1,
  activeWordIndex: -1,
  currentTime: 0.0,
  duration: 0.0,
  isPlaying: false,
  workspaceLayout: "SPLIT",       // "SPLIT" | "LECTURE_ONLY" | "CAPTIONS_ONLY"
  autoScrollCaptions: false,
  autoFollowLectureWord: true,    // Smooth word tracking in Display section
  lectureFilterCategory: "ALL",   // "ALL" | "ayah" | "hadith" | "dhikr"
  lectureSearchQuery: "",
  isLectureEditMode: false,
  snapAllToCanonical: false,
  undoStack: [],
  pendingSelectionSpan: null,     // { wordStartIdx, wordEndIdx, text, category }
  datasetBrowser: {
    activeTab: "ADHKAR",          // "ADHKAR" | "OUTSIDE_CORPUS" | "QURAN" | "HADITH"
    searchQuery: "",
    adhkarFilter: "ALL",          // "ALL" | "CUSTOM" | "BUILTIN"
    surahFilter: "ALL",
    bookFilter: "ALL",
    page: 1,
    pageSize: 25
  },
  outputPrefs: {
    quranBracketOpen: "﴿",
    quranBracketClose: "﴾",
    hadithBracketOpen: "«",
    hadithBracketClose: "»",
    adhkarBracketOpen: "〖",
    adhkarBracketClose: "〗",
    showQuranSource: true,
    showHadithSource: true,
    showAdhkarTag: true,
    groupContiguousAyat: true
  },
  tafrigh: {
    active: false,
    viewMode: "sync",               // "sync" | "tafrigh"
    data: null,                     // Last result from /api/tafrigh/run
    isLoading: false,
    provider: "gemini_all",
    processingMode: "per_sentence",
    matnMode: "no_matn",
    matnText: ""
  },
  aiVerification: {
    enabled: true,
    autoVerifyAfterEngine: false,
    targetScope: "HADITH_AND_CANDIDATES", // "ALL" | "HADITH_ONLY" | "HADITH_AND_CANDIDATES"
    contextWindowWords: 25,
    activeProvider: "gemini",             // "gemini" | "openrouter_jev" | "openrouter_chat" | "local_laya"
    promptConfig: null,                   // User prompt tuning; defaults live in WahyAiVerifier.DEFAULT_PROMPT_CONFIG
    selectionMode: "scope",               // "scope" | "manual" (per-lecture, not persisted)
    manualSelectedIds: [],                // detection ids picked in the request-options panel

    // Provider 1: Google Gemini API (Free Plan / Paid Tier)
    geminiApiKey: "",
    geminiModel: "gemini-3.5-flash-lite", // Default: latest 3.5 Flash-Lite
    geminiFreeTierMode: true,
    geminiRpmLimit: 12,
    geminiBatchSize: 5,

    // Provider 2 & 3: OpenRouter
    openRouterApiKey: "",
    openRouterMode: "jev",                // "jev" | "chat"
    openRouterJevModel: "typesafe/jev-1.14",
    openRouterSelectedModel: "deepseek/deepseek-chat",
    openRouterModelsCatalog: [],
    openRouterSearchQuery: "",

    // Provider 4: Local Laya
    layaCheckpoint: "convaiinnovations/laya-multilingual",
    layaDevice: "auto",                   // "auto" | "cuda" | "cpu"
    layaCustomCheckpointPath: "",
    layaBackendReady: false,

    // Display & Editor Verdict Filter
    visibilityFilter: {
      showCorrect: true,
      showNotSure: true,
      showFalse: false,
      showUnverified: true,
      showClippedOnly: false
    },

    // Metrics Summary
    metrics: {
      engineDetectionTimeMs: 0,
      totalRequests: 0,
      successfulRequests: 0,
      failedOrRateLimitedRequests: 0,
      totalFindingsEvaluated: 0,
      clippedCount: 0,
      verdictCounts: { CORRECT: 0, FALSE: 0, NOT_SURE: 0 },
      requestsFullTimeMs: 0,
      avgRequestTimeMs: 0,
      totalContextTokens: 0,
      totalOutputTokens: 0,
      avgContextTokensPerRequest: 0,
      totalContextChars: 0,
      avgContextCharsPerRequest: 0,
      estimatedTotalCostUsd: 0.0
    },

    requestLogs: [],
    trainingDatasetRecords: []
  }
};

window.state = currentState;

const LS_AI_CONFIG_KEY = "wahyTranscriber_aiConfig_v22";
const IDB_AI_TRAINING_DB_NAME = "WahyLayaTrainingDB";
const IDB_AI_TRAINING_STORE_NAME = "verification_records";

function loadSavedUserDatasetsAndPrefs() {
  try {
    const savedAdhkar = localStorage.getItem(LS_CUSTOM_ADHKAR_KEY);
    if (savedAdhkar) {
      const parsed = JSON.parse(savedAdhkar);
      if (Array.isArray(parsed) && parsed.length > 0) {
        RAW_ADHKAR_DATA = parsed;
      }
    } else {
      // Migrate once from v21: keep only what the user added themselves, on top of the new built-in list
      const old = JSON.parse(localStorage.getItem(LS_CUSTOM_ADHKAR_KEY_V21) || "null");
      const mine = Array.isArray(old) ? old.filter(x => x && x.isCustom) : [];
      RAW_ADHKAR_DATA = [...mine, ...BUILTIN_ADHKAR_DATA.map(x => ({ ...x }))];
      localStorage.setItem(LS_CUSTOM_ADHKAR_KEY, JSON.stringify(RAW_ADHKAR_DATA));
    }
  } catch (e) {}

  try {
    const savedOutside = localStorage.getItem(LS_OUTSIDE_HADITH_KEY);
    if (savedOutside) {
      const parsed = JSON.parse(savedOutside);
      if (Array.isArray(parsed)) {
        RAW_OUTSIDE_HADITH_DATA = parsed;
      }
    }
  } catch (e) {}

  try {
    const savedPrefs = localStorage.getItem(LS_OUTPUT_PREFS_KEY);
    if (savedPrefs) {
      const parsed = JSON.parse(savedPrefs);
      if (parsed && typeof parsed === "object") {
        currentState.outputPrefs = Object.assign({}, currentState.outputPrefs, parsed);
      }
    }
  } catch (e) {}

  try {
    const savedAi = localStorage.getItem(LS_AI_CONFIG_KEY);
    if (savedAi) {
      const parsed = JSON.parse(savedAi);
      if (parsed && typeof parsed === "object") {
        const currentVis = Object.assign({}, currentState.aiVerification.visibilityFilter, parsed.visibilityFilter || {});
        currentState.aiVerification = Object.assign({}, currentState.aiVerification, parsed);
        currentState.aiVerification.visibilityFilter = currentVis;
      }
    }
  } catch (e) {}
}
loadSavedUserDatasetsAndPrefs();

function saveAiConfigToStorage() {
  try {
    const cfg = {
      enabled: currentState.aiVerification.enabled,
      autoVerifyAfterEngine: currentState.aiVerification.autoVerifyAfterEngine,
      targetScope: currentState.aiVerification.targetScope,
      contextWindowWords: currentState.aiVerification.contextWindowWords,
      activeProvider: currentState.aiVerification.activeProvider,
      geminiApiKey: currentState.aiVerification.geminiApiKey,
      geminiModel: currentState.aiVerification.geminiModel,
      geminiFreeTierMode: currentState.aiVerification.geminiFreeTierMode,
      geminiRpmLimit: currentState.aiVerification.geminiRpmLimit,
      geminiBatchSize: currentState.aiVerification.geminiBatchSize,
      openRouterApiKey: currentState.aiVerification.openRouterApiKey,
      openRouterMode: currentState.aiVerification.openRouterMode,
      openRouterJevModel: currentState.aiVerification.openRouterJevModel,
      openRouterSelectedModel: currentState.aiVerification.openRouterSelectedModel,
      layaCheckpoint: currentState.aiVerification.layaCheckpoint,
      layaDevice: currentState.aiVerification.layaDevice,
      layaCustomCheckpointPath: currentState.aiVerification.layaCustomCheckpointPath,
      visibilityFilter: currentState.aiVerification.visibilityFilter,
      promptConfig: currentState.aiVerification.promptConfig
    };
    localStorage.setItem(LS_AI_CONFIG_KEY, JSON.stringify(cfg));
  } catch (e) {}
}

// -----------------------------------------------------------------------------
// IndexedDB Training Dataset Store (WahyLayaTrainingDB)
// -----------------------------------------------------------------------------

function openWahyLayaTrainingDB() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) {
      return reject(new Error("IndexedDB غير مدعوم في هذا المتصفح."));
    }
    const req = window.indexedDB.open(IDB_AI_TRAINING_DB_NAME, 1);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(IDB_AI_TRAINING_STORE_NAME)) {
        const store = db.createObjectStore(IDB_AI_TRAINING_STORE_NAME, { keyPath: "id" });
        store.createIndex("verdict", "answers.verdict.choice", { unique: false });
        store.createIndex("timestamp", "meta.converted_at", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("فشل فتح قاعدة بيانات WahyLayaTrainingDB"));
  });
}

async function saveVerificationRecordToDB(record) {
  if (!record || !record.id) return null;
  try {
    const db = await openWahyLayaTrainingDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([IDB_AI_TRAINING_STORE_NAME], "readwrite");
      const store = tx.objectStore(IDB_AI_TRAINING_STORE_NAME);
      const req = store.put(record);
      req.onsuccess = () => {
        // Keep in-memory cache synchronized
        const idx = currentState.aiVerification.trainingDatasetRecords.findIndex(r => r.id === record.id);
        if (idx >= 0) {
          currentState.aiVerification.trainingDatasetRecords[idx] = record;
        } else {
          currentState.aiVerification.trainingDatasetRecords.push(record);
        }
        resolve(record);
      };
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn("Failed to persist verification record to IndexedDB:", err);
    return null;
  }
}

async function getAllVerificationRecordsFromDB() {
  try {
    const db = await openWahyLayaTrainingDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([IDB_AI_TRAINING_STORE_NAME], "readonly");
      const store = tx.objectStore(IDB_AI_TRAINING_STORE_NAME);
      const req = store.getAll();
      req.onsuccess = () => {
        const records = req.result || [];
        currentState.aiVerification.trainingDatasetRecords = records;
        resolve(records);
      };
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn("Failed to read verification records from IndexedDB:", err);
    return [];
  }
}

async function clearVerificationRecordsDB() {
  try {
    const db = await openWahyLayaTrainingDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([IDB_AI_TRAINING_STORE_NAME], "readwrite");
      const store = tx.objectStore(IDB_AI_TRAINING_STORE_NAME);
      const req = store.clear();
      req.onsuccess = () => {
        currentState.aiVerification.trainingDatasetRecords = [];
        resolve(true);
      };
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn("Failed to clear IndexedDB records:", err);
    return false;
  }
}

// Automatically load training records into state on startup
if (typeof window !== "undefined") {
  getAllVerificationRecordsFromDB().catch(() => {});
}

function persistUserDatasetsToStorage() {
  try {
    localStorage.setItem(LS_CUSTOM_ADHKAR_KEY, JSON.stringify(RAW_ADHKAR_DATA));
    localStorage.setItem(LS_OUTSIDE_HADITH_KEY, JSON.stringify(RAW_OUTSIDE_HADITH_DATA));
  } catch (e) {}

  if (typeof currentState === "object" && currentState.corpus) {
    currentState.corpus.adhkar = RAW_ADHKAR_DATA;
  }

  if (typeof WahyCorpusLoader === "object" && typeof WahyCorpusLoader.writeCorpusToWahyDB === "function") {
    WahyCorpusLoader.writeCorpusToWahyDB({
      version: "2.1",
      loadedAt: currentState.corpus?.loadedAt || new Date().toISOString(),
      sourceSummary: currentState.corpus?.sourceSummary || "Updated Datasets",
      ayat: RAW_QURAN_DATA,
      hadiths: RAW_HADITH_DATA,
      adhkar: RAW_ADHKAR_DATA,
      outsideHadiths: RAW_OUTSIDE_HADITH_DATA
    }).catch(() => {});
  }
}

function getOutputDisplayPrefs() {
  return currentState.outputPrefs;
}

function saveOutputDisplayPrefs(partialPrefs = {}) {
  currentState.outputPrefs = Object.assign({}, currentState.outputPrefs, partialPrefs);
  try {
    localStorage.setItem(LS_OUTPUT_PREFS_KEY, JSON.stringify(currentState.outputPrefs));
  } catch (e) {}
  return currentState.outputPrefs;
}

function showToast(msg) {
  const box = document.getElementById("toastBox");
  const txt = document.getElementById("toastText");
  if (!box || !txt) return;
  txt.textContent = msg;
  box.classList.remove("hidden");
  clearTimeout(window.__toastTimer);
  window.__toastTimer = setTimeout(() => box.classList.add("hidden"), 3400);
}

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function pushUndoSnapshot(actionLabel = "تعديل") {
  const snap = {
    actionLabel,
    timestamp: new Date().toISOString(),
    rawText: currentState.rawText,
    rawTranscript: currentState.rawTranscript,
    words: JSON.parse(JSON.stringify(currentState.words || [])),
    detections: JSON.parse(JSON.stringify(currentState.detections || [])),
    captions: JSON.parse(JSON.stringify(currentState.captions || []))
  };
  currentState.undoStack.push(snap);
  if (currentState.undoStack.length > 25) currentState.undoStack.shift();
  const btnUndo = document.getElementById("btnUndoAction");
  if (btnUndo) btnUndo.classList.remove("hidden");
}

function popUndoSnapshot() {
  if (!currentState.undoStack.length) {
    showToast("لا توجد خطوات سابقة للتراجع عنها.");
    return;
  }
  const snap = currentState.undoStack.pop();
  currentState.rawText = snap.rawText;
  currentState.rawTranscript = snap.rawTranscript;
  currentState.words = snap.words;
  currentState.detections = snap.detections;
  currentState.captions = snap.captions;

  const btnUndo = document.getElementById("btnUndoAction");
  if (btnUndo && !currentState.undoStack.length) {
    btnUndo.classList.add("hidden");
  }
  if (typeof renderAllViews === "function") {
    renderAllViews();
  }
  showToast(`↩️ تم التراجع عن: ${snap.actionLabel}`);
}

/**
 * Register a new or custom Dhikr directly into RAW_ADHKAR_DATA, persist it, and rebuild matcher.
 */
function registerOutsideDhikrInDataset(text, refLabel = "ذكر مأثور", categoryLabel = "ذكر مضاف") {
  const cleanT = String(text || "").trim();
  if (!cleanT || (typeof tokenizeText === "function" && tokenizeText(cleanT).length < 2)) {
    showToast("⚠️ يرجى إدخال نص ذكر يحتوي على كلمتين على الأقل.");
    return null;
  }
  const normT = typeof normalizeArabic === "function" ? normalizeArabic(cleanT) : cleanT;
  const existing = RAW_ADHKAR_DATA.find(item => {
    const itNorm = typeof normalizeArabic === "function" ? normalizeArabic(item.t) : item.t;
    return itNorm === normT;
  });
  if (existing) {
    if (refLabel && refLabel !== "ذكر") existing.ref = refLabel;
    if (categoryLabel) existing.category = categoryLabel;
    persistUserDatasetsToStorage();
    rebuildMatcher();
    showToast("ℹ️ الذكر موجود مسبقاً في قاعدة الأذكار وتم تحديث بياناته.");
    return existing;
  }
  const newItem = {
    id: `Adhkar:custom_${Date.now()}_${RAW_ADHKAR_DATA.length + 1}`,
    category: (categoryLabel || refLabel || "ذكر مضاف").trim(),
    ref: (refLabel || categoryLabel || "ذكر مأثور").trim(),
    t: cleanT,
    isCustom: true
  };
  RAW_ADHKAR_DATA.unshift(newItem);
  persistUserDatasetsToStorage();
  rebuildMatcher();
  if (typeof renderDatasetsSection === "function") {
    renderDatasetsSection();
  }
  return newItem;
}

/**
 * Register an Outside-of-Corpus Hadith/Athar into RAW_OUTSIDE_HADITH_DATA, persist it, and rebuild matcher.
 */
function registerOutsideCorpusHadithInDataset(text, refLabel = "حديث خارج القاعدة") {
  const cleanT = String(text || "").trim();
  if (!cleanT || cleanT.length < 4) return null;
  const normT = typeof normalizeArabic === "function" ? normalizeArabic(cleanT) : cleanT;
  const existing = RAW_OUTSIDE_HADITH_DATA.find(item => {
    const itNorm = typeof normalizeArabic === "function" ? normalizeArabic(item.t) : item.t;
    return itNorm === normT;
  });
  if (existing) {
    if (refLabel && refLabel !== "حديث خارج القاعدة") existing.ref = refLabel;
    persistUserDatasetsToStorage();
    rebuildMatcher();
    return existing;
  }
  const newItem = {
    id: `Outside:${Date.now()}_${RAW_OUTSIDE_HADITH_DATA.length + 1}`,
    book: "OutsideCorpus",
    ref: (refLabel || "حديث خارج القاعدة").trim(),
    t: cleanT
  };
  RAW_OUTSIDE_HADITH_DATA.unshift(newItem);
  persistUserDatasetsToStorage();
  rebuildMatcher();
  if (typeof renderDatasetsSection === "function") {
    renderDatasetsSection();
  }
  return newItem;
}

function alignTranscriptSegToUnit(tNorms, s, e, unit, hintQS = null) {
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
        score += 1.4 * activeMatcher.getIdf(qw);
        matchedToks += 2;
        ti += 2;
        qi += 1;
        continue;
      }
      if (qi + 1 < qLen && isFusedTwoToOneMatch(qw, qWords[qi + 1], tw)) {
        score += 1.4 * activeMatcher.getIdf(qw);
        matchedToks += 1;
        ti += 1;
        qi += 2;
        continue;
      }
      const qv = wordMatchQuality(tw, qw, unit.sourceType === "QURAN" ? unit.unitId : "", unit.vocalizedWords[qi]);
      if (qv > 0) {
        score += qv * activeMatcher.getIdf(qw);
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

function recomputeCanonicalForDetection(det, rawTokens) {
  if (!rawTokens || !rawTokens.length || !det.segments || !det.segments.length) return;
  det.tStart = Math.max(0, Math.min(rawTokens.length - 1, det.segments[0][0]));
  det.tEnd = Math.max(det.tStart + 1, Math.min(rawTokens.length, det.segments[det.segments.length - 1][1]));
  det.charStart = rawTokens[det.tStart].charStart;
  det.charEnd = rawTokens[det.tEnd - 1].charEnd;

  const unit = activeMatcher && activeMatcher.units ? activeMatcher.units.get(det.unitId) : null;
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
    const [bestQS, bestQE] = alignTranscriptSegToUnit(tNorms, s, e, target, prevHint);
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

function rebuildMatcher() {
  const params = {
    minIslandIdf: parseFloat(document.getElementById("rngMinIslandIdf")?.value || "3.8"),
    maxTranscriptGap: parseInt(document.getElementById("rngMaxTranscriptGap")?.value || "10", 10),
    maxVerseGap: parseInt(document.getElementById("rngMaxVerseGap")?.value || "2", 10),
    verifiedThreshold: parseFloat(document.getElementById("rngVerifiedThreshold")?.value || "11.0"),
    candidateThreshold: parseFloat(document.getElementById("rngCandidateThreshold")?.value || "6.8"),
    uncuedHadithThreshold: parseFloat(document.getElementById("rngUncuedHadithThreshold")?.value || "16.0"),
    minHadithContentWords: parseInt(document.getElementById("rngMinHadithContentWords")?.value || "3", 10),
    uncuedQuranCoverage: parseInt(document.getElementById("rngUncuedQuranCoverage")?.value || "65", 10)
  };

  const activeAdhkar = currentState.adhkarEnabled !== false ? RAW_ADHKAR_DATA : [];
  const activeOutside = currentState.outsideCorpusEnabled !== false ? RAW_OUTSIDE_HADITH_DATA : [];

  // Engine v4 is opt-in: localStorage.wahyEngine = "v4" (or "v3" to switch back). Falls back to v3 if v4 fails to build.
  let engineChoice = "v3";
  try { engineChoice = localStorage.getItem("wahyEngine") || "v3"; } catch (e) { /* storage blocked */ }
  activeMatcher = null;
  if (engineChoice === "v4" && typeof WahyEngine !== "undefined") {
    try {
      activeMatcher = new WahyEngine(RAW_QURAN_DATA, RAW_HADITH_DATA, params, activeAdhkar, activeOutside);
    } catch (e) {
      console.error("WahyEngine v4 failed to initialise, falling back to v3", e);
    }
  }
  if (!activeMatcher) {
    activeMatcher = new QuotationMatcherJS(
      RAW_QURAN_DATA,
      RAW_HADITH_DATA,
      params,
      activeAdhkar,
      activeOutside
    );
  }

  const countBadge = document.getElementById("corpusCountLabel");
  if (countBadge) {
    countBadge.textContent = `القرآن: ${RAW_QURAN_DATA.length} | الحديث: ${RAW_HADITH_DATA.length} | الأذكار: ${RAW_ADHKAR_DATA.length}`;
  }
  const navAdhkarBadge = document.getElementById("navBadgeAdhkarCount");
  if (navAdhkarBadge) {
    navAdhkarBadge.textContent = String(RAW_ADHKAR_DATA.length);
  }
}

function syncRawTextFromWords() {
  let cursor = 0;
  const parts = [];
  (currentState.words || []).forEach((w, idx) => {
    w.id = idx;
    w.word = String(w.word || "").trim();
    w.char_start = cursor;
    w.char_end = cursor + w.word.length;
    parts.push(w.word);
    cursor = w.char_end + 1;
  });
  const joined = parts.join(" ");
  currentState.rawText = joined;
  currentState.rawTranscript = joined;
}

function runDetectionAndBuildCaptions(options = {}) {
  if (!activeMatcher) rebuildMatcher();

  if (options.rawText !== undefined) {
    // a new transcript is a new saved session (re-running the engine on the same text keeps the same one)
    currentState.currentLectureId = null;
    currentState.lectureCreatedAt = null;
    currentState.isDemoSession = false;
    const cleanText = String(options.rawText || "").trim();
    currentState.rawText = cleanText;
    currentState.rawTranscript = cleanText;
    currentState.words = (options.words && options.words.length)
      ? options.words
      : synthesizeWordsFromRawText(cleanText);
  } else if (currentState.words && currentState.words.length && !currentState.rawTranscript) {
    syncRawTextFromWords();
  } else if (currentState.rawTranscript && (!currentState.words || !currentState.words.length)) {
    currentState.words = synthesizeWordsFromRawText(currentState.rawTranscript);
  }

  syncRawTextFromWords();

  const t0 = performance.now();
  const rawDets = activeMatcher.detect(currentState.rawTranscript);
  const mappedDets = mapDetectionsToWordTimestamps(rawDets, currentState.words, currentState.rawTranscript);

  if (currentState.snapAllToCanonical) {
    mappedDets.forEach(d => { d.snappedToCanonical = true; });
  }

  currentState.detections = mappedDets;
  currentState.captions = buildSmartCaptions(currentState.words, currentState.detections, currentState.outputPrefs);

  const lastWord = currentState.words[currentState.words.length - 1];
  currentState.duration = lastWord ? Number(lastWord.end) : 0.0;

  if (currentState.selectedPredIndex >= currentState.detections.length) {
    currentState.selectedPredIndex = currentState.detections.length ? 0 : -1;
  }

  const elapsedMs = (performance.now() - t0).toFixed(1);
  currentState.lastElapsedMs = elapsedMs;

  if (typeof logWahyAction === "function") {
    logWahyAction("PIPELINE_EXECUTED", {
      words: currentState.words.length,
      detections: currentState.detections.length,
      captions: currentState.captions.length,
      elapsedMs
    });
  }

  if (typeof renderAllViews === "function") {
    renderAllViews();
  }
}

function recalculateCaptionsFromCurrentFindings() {
  syncRawTextFromWords();
  const rawTokens = typeof tokenizeText === "function" ? tokenizeText(currentState.rawTranscript) : [];

  currentState.detections.forEach((det, idx) => {
    det.id = det.id || `finding_${idx + 1}`;
    if (typeof det.wordStartIdx !== "number" && Array.isArray(det.segments) && det.segments.length) {
      det.wordStartIdx = det.segments[0][0];
      det.wordEndIdx = Math.max(det.wordStartIdx, det.segments[det.segments.length - 1][1] - 1);
    }
    const maxW = Math.max(0, (currentState.words || []).length - 1);
    det.wordStartIdx = Math.max(0, Math.min(maxW, det.wordStartIdx || 0));
    det.wordEndIdx = Math.max(det.wordStartIdx, Math.min(maxW, det.wordEndIdx || det.wordStartIdx));

    const firstW = currentState.words[det.wordStartIdx] || currentState.words[0];
    const lastW = currentState.words[det.wordEndIdx] || firstW;
    if (firstW && lastW) {
      det.startIndex = firstW.char_start;
      det.endIndex = lastW.char_end;
      det.charStart = firstW.char_start;
      det.charEnd = lastW.char_end;
      det.startTime = Number(firstW.start);
      det.endTime = Number(lastW.end);
      det.matchedText = currentState.words
        .slice(det.wordStartIdx, det.wordEndIdx + 1)
        .map(w => w.word)
        .join(" ");
    }
    if (!det.canonicalText && Array.isArray(det.canonicalSegments) && det.canonicalSegments.length) {
      det.canonicalText = det.canonicalSegments.join(" ");
    } else if (!det.canonicalText && rawTokens.length) {
      det.canonicalText = det.matchedText;
    }
  });

  currentState.captions = buildSmartCaptions(currentState.words, currentState.detections, currentState.outputPrefs);
  if (typeof renderAllViews === "function") {
    renderAllViews();
  }
}

function buildDynamicSampleLectureFromCorpus() {
  const findAyah = (s, a) => {
    const hit = RAW_QURAN_DATA.find(q => Number(q.s) === s && Number(q.a) === a);
    return hit ? hit.t : "";
  };
  const aFatiha2 = findAyah(1, 2) || "الْحَمْدُ لِلَّهِ رَبِّ الْعَالَمِينَ";
  const aBaqara255 = findAyah(2, 255) || "اللَّهُ لَا إِلَٰهَ إِلَّا هُوَ الْحَيُّ الْقَيُّومُ لَا تَأْخُذُهُ سِنَةٌ وَلَا نَوْمٌ";
  const aAhzab70 = findAyah(33, 70) || "يَا أَيُّهَا الَّذِينَ آمَنُوا اتَّقُوا اللَّهَ وَقُولُوا قَوْلًا سَدِيدًا";
  const aAsr1 = findAyah(103, 1) || "وَالْعَصْرِ";
  const aAsr2 = findAyah(103, 2) || "إِنَّ الْإِنْسَانَ لَفِي خُسْرٍ";
  const aAsr3 = findAyah(103, 3) || "إِلَّا الَّذِينَ آمَنُوا وَعَمِلُوا الصَّالِحَاتِ وَتَوَاصَوْا بِالْحَقِّ وَتَوَاصَوْا بِالصَّبْرِ";

  const sampleHadith1 = (RAW_HADITH_DATA[0] && stripIsnad(RAW_HADITH_DATA[0].t)) ||
    "إنما الأعمال بالنيات وإنما لكل امرئ ما نوى فمن كانت هجرته إلى الله ورسوله فهجرته إلى الله ورسوله";

  const sampleDhikr1 = (RAW_ADHKAR_DATA[0] && RAW_ADHKAR_DATA[0].t) ||
    "سبحانك اللهم وبحمدك أشهد أن لا إله إلا أنت أستغفرك وأتوب إليك";

  return [
    `إن الحمد لله نحمده ونستعينه ونستغفره، ونفتتح درسنا اليوم بقول الله تبارك وتعالى في فاتحة الكتاب: ${aFatiha2}، ونسأله سبحانه الإخلاص والقبول في القول والعمل.`,
    `اعلموا رحمكم الله أن مدار صلاح الأعمال كلها على تقوى الله وتحري الصدق، كما أمرنا ربنا جل وعلا في سورة الأحزاب حيث قال تعالى: ${aAhzab70}، فالتقوى والقول السديد أصل كل خير في الدنيا والآخرة.`,
    `وقد جاء في الحديث الصحيح عن أمير المؤمنين عمر بن الخطاب رضي الله عنه أن النبي صلى الله عليه وسلم قال: ${sampleHadith1}، وهذا أصل عظيم من أصول الإسلام يدور عليه ثواب الأعمال.`,
    `ومن أعظم آيات التوحيد في كتاب الله آية الكرسي في سورة البقرة، قال الله عز وجل: ${aBaqara255}، فينبغي للمؤمن أن يتدبر معانيها عند كل صلاة.`,
    `وتذكروا وصية الله الجامعة في سورة العصر حيث أقسم سبحانه فقال: ${aAsr1} ${aAsr2} ${aAsr3}، ونختم مجلسنا هذا بالذكر المأثور في كفارة المجلس: ${sampleDhikr1}.`
  ].join("\n\n");
}


// =============================================================================
// IndexedDB Lecture Sessions Store (WahyLecturesDB)
// File: js/state.js
// =============================================================================

const IDB_LECTURES_DB_NAME = "WahyLecturesDB";
const IDB_LECTURES_STORE_NAME = "lectures";

function openWahyLecturesDB() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) {
      return reject(new Error("IndexedDB غير مدعوم في هذا المتصفح."));
    }
    const req = window.indexedDB.open(IDB_LECTURES_DB_NAME, 2);   // v2: an older DB of this name may exist without the store
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(IDB_LECTURES_STORE_NAME)) {
        const store = db.createObjectStore(IDB_LECTURES_STORE_NAME, { keyPath: "id" });
        store.createIndex("title", "title", { unique: false });
        store.createIndex("updated_at", "updated_at", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("فشل فتح قاعدة بيانات WahyLecturesDB"));
  });
}

async function saveCurrentLectureSession(customTitle = null) {
  try {
    const db = await openWahyLecturesDB();
    const id = currentState.currentLectureId || ("lec_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6));
    currentState.currentLectureId = id;
    const title = customTitle || currentState.lectureTitle || "محاضرة علمية محفوطة";

    const sessionPayload = {
      id,
      title,
      created_at: currentState.lectureCreatedAt || new Date().toISOString(),
      updated_at: new Date().toISOString(),
      mediaUrl: currentState.mediaUrl || "",
      mediaType: currentState.mediaType || "text",
      rawText: currentState.rawText || "",
      rawTranscript: currentState.rawTranscript || "",
      words: currentState.words || [],
      detections: currentState.detections || [],
      captions: currentState.captions || [],
      tafrighResult: currentState.tafrighResult || null,
      stats: {
        wordsCount: (currentState.words || []).length,
        detectionsCount: (currentState.detections || []).length,
        captionsCount: (currentState.captions || []).length
      }
    };

    return new Promise((resolve, reject) => {
      const tx = db.transaction([IDB_LECTURES_STORE_NAME], "readwrite");
      const store = tx.objectStore(IDB_LECTURES_STORE_NAME);
      const req = store.put(sessionPayload);
      req.onsuccess = () => resolve(sessionPayload);
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.error("Failed to save lecture session:", err);
    return null;
  }
}

async function loadLectureSession(sessionId) {
  try {
    const db = await openWahyLecturesDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([IDB_LECTURES_STORE_NAME], "readonly");
      const store = tx.objectStore(IDB_LECTURES_STORE_NAME);
      const req = store.get(sessionId);
      req.onsuccess = () => {
        const item = req.result;
        if (item) {
          currentState.currentLectureId = item.id;
          currentState.lectureTitle = item.title;
          currentState.lectureCreatedAt = item.created_at;
          currentState.mediaUrl = item.mediaUrl || "";
          currentState.mediaType = item.mediaType || "text";
          currentState.rawText = item.rawText || "";
          currentState.rawTranscript = item.rawTranscript || item.rawText || "";
          currentState.words = Array.isArray(item.words) ? item.words : [];
          currentState.detections = Array.isArray(item.detections) ? item.detections : [];
          currentState.captions = Array.isArray(item.captions) ? item.captions : [];
          currentState.tafrighResult = item.tafrighResult || null;
          currentState.selectedPredIndex = -1;
          currentState.selectedCaptionIndex = -1;
          currentState.undoStack = [];
          currentState.isDemoSession = false;
          resolve(item);
        } else {
          reject(new Error("لم يتم العثور على الجلسة"));
        }
      };
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.error("Failed to load lecture session:", err);
    return null;
  }
}

async function listSavedLectureSessions() {
  try {
    const db = await openWahyLecturesDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([IDB_LECTURES_STORE_NAME], "readonly");
      const store = tx.objectStore(IDB_LECTURES_STORE_NAME);
      const req = store.getAll();
      req.onsuccess = () => {
        const list = (req.result || []).sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
        resolve(list);
      };
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.error("Failed to list lecture sessions:", err);
    return [];
  }
}

async function deleteSavedLectureSession(sessionId) {
  try {
    const db = await openWahyLecturesDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([IDB_LECTURES_STORE_NAME], "readwrite");
      const store = tx.objectStore(IDB_LECTURES_STORE_NAME);
      const req = store.delete(sessionId);
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.error("Failed to delete lecture session:", err);
    return false;
  }
}


// -----------------------------------------------------------------------------
// Autosave / restore: the working session survives a page refresh
// -----------------------------------------------------------------------------
const MAX_SAVED_LECTURE_SESSIONS = 10;
let _autosaveTimer = null;
let _autosavePending = false;

function scheduleSessionAutosave() {
  if (currentState.isDemoSession || !(currentState.words || []).length) return;
  _autosavePending = true;
  clearTimeout(_autosaveTimer);
  _autosaveTimer = setTimeout(flushSessionAutosave, 700);
}

async function flushSessionAutosave() {
  clearTimeout(_autosaveTimer);
  if (currentState.isDemoSession) { _autosavePending = false; return; }
  if (!_autosavePending) return;
  _autosavePending = false;
  const saved = await saveCurrentLectureSession();
  if (!saved) { _autosavePending = true; return; }
  if (typeof renderSavedLecturesList === "function") renderSavedLecturesList();   // keep the "unsaved" flag so the refresh warning stays on
  try {
    const all = await listSavedLectureSessions();      // newest first
    for (const old of all.slice(MAX_SAVED_LECTURE_SESSIONS)) await deleteSavedLectureSession(old.id);
  } catch (e) { /* pruning is best effort */ }
}

/** Load the most recently edited saved session into currentState. Returns it, or null when none exists. */
async function restoreLatestLectureSession() {
  const list = await listSavedLectureSessions();
  const latest = list.find(x => Array.isArray(x.words) && x.words.length);
  if (!latest) return null;
  return await loadLectureSession(latest.id);
}

window.addEventListener("beforeunload", (e) => {
  if (!_autosavePending) return;
  flushSessionAutosave();
  e.preventDefault();      // an edit is still being written: ask before the page goes away
  e.returnValue = "";
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") flushSessionAutosave();
});

async function renameSavedLectureSession(sessionId, newTitle) {
  try {
    const db = await openWahyLecturesDB();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction([IDB_LECTURES_STORE_NAME], "readwrite");
      const store = tx.objectStore(IDB_LECTURES_STORE_NAME);
      const getReq = store.get(sessionId);
      getReq.onsuccess = () => {
        const item = getReq.result;
        if (!item) return resolve(false);
        item.title = newTitle;
        item.updated_at = new Date().toISOString();
        const putReq = store.put(item);
        putReq.onsuccess = () => resolve(true);
        putReq.onerror = () => reject(putReq.error);
      };
      getReq.onerror = () => reject(getReq.error);
    });
  } catch (err) {
    console.error("Failed to rename lecture session:", err);
    return false;
  }
}
