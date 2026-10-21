// =============================================================================
// Wahy Studio (Wahy-Transcriber v2.1) — Dynamic Corpus Downloader & Adhkar Merger
// File: js/corpus-loader.js
// =============================================================================

const CORPUS_IDB_NAME = "WahyCorpusDB";
const CORPUS_IDB_VERSION = 2;
const CORPUS_IDB_STORE = "datasets";
const CORPUS_CACHE_KEY = "normalized_corpus_v3"; // v3: drops caches holding "[object Object]" hadith refs
const LS_CORPUS_URLS_KEY = "wahyFinder_remoteCorpusUrls_v2";

const DEFAULT_CORPUS_ENDPOINTS = {
  quranUthmaniUrl: "https://api.alquran.cloud/v1/quran/quran-uthmani",
  quranSimpleUrl: "https://api.alquran.cloud/v1/quran/quran-simple-clean",
  quranFallbackUrl: "https://cdn.jsdelivr.net/npm/quran-json@3.1.2/dist/quran.json",
  customCorpusJsonUrl: "",
  hadithMirrors: [
    { key: "Nawawi40", title: "الأربعون النووية", url: "https://cdn.jsdelivr.net/gh/fawazahmed0/hadith-api@1/editions/ara-nawawi.min.json" },
    { key: "Qudsi40", title: "الأربعون القدسية", url: "https://cdn.jsdelivr.net/gh/fawazahmed0/hadith-api@1/editions/ara-qudsi.min.json" },
    { key: "RiyadSalihin", title: "رياض الصالحين", url: "https://raw.githubusercontent.com/AhmedBaset/hadith-json/v1.2.0/db/by_book/other_books/riyad_assalihin.json" }
  ],
};

function getCorpusEndpointsConfig() {
  try {
    const raw = localStorage.getItem(LS_CORPUS_URLS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return Object.assign({}, DEFAULT_CORPUS_ENDPOINTS, parsed);
    }
  } catch (e) {}
  return Object.assign({}, DEFAULT_CORPUS_ENDPOINTS);
}

function saveCorpusEndpointsConfig(customConfig) {
  const merged = Object.assign(getCorpusEndpointsConfig(), customConfig || {});
  try {
    localStorage.setItem(LS_CORPUS_URLS_KEY, JSON.stringify(merged));
  } catch (e) {}
  return merged;
}

function openWahyCorpusDB() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      resolve(null);
      return;
    }
    const req = indexedDB.open(CORPUS_IDB_NAME, CORPUS_IDB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(CORPUS_IDB_STORE)) {
        db.createObjectStore(CORPUS_IDB_STORE);
      }
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = (e) => reject(e.target.error || new Error("Failed to open WahyCorpusDB"));
  });
}

async function readCorpusFromWahyDB(key = CORPUS_CACHE_KEY) {
  try {
    const db = await openWahyCorpusDB();
    if (!db) return null;
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(CORPUS_IDB_STORE, "readonly");
      const store = tx.objectStore(CORPUS_IDB_STORE);
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  } catch (e) {
    return null;
  }
}

async function writeCorpusToWahyDB(payload, key = CORPUS_CACHE_KEY) {
  try {
    const db = await openWahyCorpusDB();
    if (!db) return false;
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(CORPUS_IDB_STORE, "readwrite");
      const store = tx.objectStore(CORPUS_IDB_STORE);
      store.put(payload, key);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  } catch (e) {
    return false;
  }
}

async function clearWahyCorpusDB() {
  try {
    const db = await openWahyCorpusDB();
    if (!db) return false;
    await new Promise((resolve, reject) => {
      const tx = db.transaction(CORPUS_IDB_STORE, "readwrite");
      const store = tx.objectStore(CORPUS_IDB_STORE);
      store.clear();
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
    return true;
  } catch (e) {
    return false;
  }
}

function updateCorpusProgressUI(percent, statusText, isDownloading = true) {
  const barWrap = document.getElementById("corpusDownloadProgressWrap");
  const barFill = document.getElementById("corpusDownloadProgressBar");
  const pctLabel = document.getElementById("corpusDownloadPercentLabel");
  const statusLabel = document.getElementById("corpusDownloadStatusLabel");

  if (barWrap) {
    if (isDownloading) {
      barWrap.classList.remove("hidden");
    } else {
      setTimeout(() => {
        barWrap.classList.add("hidden");
      }, 850);
    }
  }
  const clamped = Math.max(0, Math.min(100, Math.round(percent)));
  if (barFill) barFill.style.width = `${clamped}%`;
  if (pctLabel) pctLabel.textContent = `${clamped}%`;
  if (statusLabel && statusText) statusLabel.textContent = statusText;
}

function normalizeQuranDatasets(uthmaniJson, simpleJson, fallbackJson) {
  const ayat = [];
  const simpleMap = new Map();

  if (simpleJson?.data?.surahs && Array.isArray(simpleJson.data.surahs)) {
    for (const surah of simpleJson.data.surahs) {
      const sNum = Number(surah.number);
      for (const ayah of (surah.ayahs || [])) {
        simpleMap.set(`${sNum}:${ayah.numberInSurah}`, String(ayah.text || "").trim());
      }
    }
  }

  if (uthmaniJson?.data?.surahs && Array.isArray(uthmaniJson.data.surahs)) {
    for (const surah of uthmaniJson.data.surahs) {
      const sNum = Number(surah.number);
      const rawName = String(surah.name || "").replace(/^سُورَةُ\s+|^سورة\s+/g, "").trim();
      if (rawName && typeof SURAH_NAMES_AR === "object" && !SURAH_NAMES_AR[String(sNum)]) {
        SURAH_NAMES_AR[String(sNum)] = rawName;
      }
      const sName = (typeof SURAH_NAMES_AR === "object" && SURAH_NAMES_AR[String(sNum)]) || rawName || `سورة ${sNum}`;
      for (const ayah of (surah.ayahs || [])) {
        const aNum = Number(ayah.numberInSurah);
        const tUthmani = String(ayah.text || "").trim();
        const tSimple = simpleMap.get(`${sNum}:${aNum}`) || (typeof normalizeArabic === "function" ? normalizeArabic(tUthmani) : tUthmani);
        ayat.push({
          s: sNum,
          a: aNum,
          t: tUthmani,
          simple: tSimple,
          surahName: sName
        });
      }
    }
  } else if (Array.isArray(fallbackJson)) {
    for (const surah of fallbackJson) {
      const sNum = Number(surah.id || surah.number);
      const sName = (typeof SURAH_NAMES_AR === "object" && SURAH_NAMES_AR[String(sNum)]) || surah.name || `سورة ${sNum}`;
      for (const verse of (surah.verses || surah.ayahs || [])) {
        const aNum = Number(verse.id || verse.numberInSurah);
        const tUthmani = String(verse.text || "").trim();
        ayat.push({
          s: sNum,
          a: aNum,
          t: tUthmani,
          simple: typeof normalizeArabic === "function" ? normalizeArabic(tUthmani) : tUthmani,
          surahName: sName
        });
      }
    }
  }

  return ayat;
}

function normalizeHadithPayload(rawPayload, defaultBookKey = "RemoteHadith", defaultTitle = "الحديث النبوي") {
  const normalized = [];
  const seen = new Set();

  let items = [];
  if (Array.isArray(rawPayload)) {
    items = rawPayload;
  } else if (rawPayload && Array.isArray(rawPayload.hadiths)) {
    items = rawPayload.hadiths;
  } else if (rawPayload && Array.isArray(rawPayload.data)) {
    items = rawPayload.data;
  }

  items.forEach((item, idx) => {
    const num = item.hadithnumber || item.idInBook || item.number || item.id || (idx + 1);
    const book = item.book || defaultBookKey;
    const uid = String(item.id || "").includes(":") ? String(item.id) : `${book}:${num}`;
    const text = String(item.t || item.text || item.arabic || item.arab || "").trim();
    // Some APIs (fawazahmed0 hadith-api) send `reference` as an object ({book, hadith}), not a label
    const rawRef = [item.ref, item.reference].find(r => typeof r === "string" && r.trim());
    const ref = String(rawRef || `${defaultTitle} (${num})`).trim();
    if (text && text.length >= 8 && !seen.has(uid)) {
      seen.add(uid);
      normalized.push({
        id: uid,
        book,
        ref,
        t: text
      });
    }
  });

  return normalized;
}

function normalizeAdhkarPayload(rawPayload) {
  const normalized = [];
  const seenText = new Set();

  let items = [];
  if (Array.isArray(rawPayload)) {
    items = rawPayload;
  } else if (rawPayload && Array.isArray(rawPayload.rows)) {
    items = rawPayload.rows;
  } else if (rawPayload && Array.isArray(rawPayload.adhkar)) {
    items = rawPayload.adhkar;
  } else if (rawPayload && typeof rawPayload === "object") {
    Object.entries(rawPayload).forEach(([cat, arr]) => {
      if (Array.isArray(arr)) {
        arr.forEach(entry => items.push(Object.assign({ category: cat }, entry)));
      }
    });
  }

  items.forEach((item) => {
    let category = "ذكر";
    let text = "";
    let ref = "ذكر مأثور";
    if (Array.isArray(item)) {
      category = String(item[0] || "ذكر").trim();
      text = String(item[1] || "").trim();
      ref = String(item[4] || item[0] || "ذكر مأثور").trim();
    } else if (item && typeof item === "object") {
      category = String(item.category || item.cat || "ذكر").trim();
      text = String(item.t || item.zekr || item.text || item.arabic || item.content || "").trim();
      ref = String(item.ref || item.reference || item.category || "ذكر مأثور").trim();
    }
    text = text.replace(/\\n/g, " ").replace(/\s+/g, " ").trim();
    if (text && text.length >= 10 && text.length <= 650 && !seenText.has(text)) {
      seenText.add(text);
      normalized.push({
        id: item?.id || `Adhkar:${normalized.length + 1}`,
        category,
        ref: ref || category || "ذكر",
        t: text,
        isCustom: Boolean(item?.isCustom)
      });
    }
  });

  return normalized.slice(0, 260);
}

/**
 * The adhkar in use: the user's saved list (built-in essentials + their own additions). Adhkar shipped inside a
 * corpus file or a download are ignored on purpose — the user curates adhkar themselves in the Adhkar studio.
 */
function mergeAdhkarPreservingUserEdits() {
  let localSaved = null;
  try {
    const raw = localStorage.getItem(LS_CUSTOM_ADHKAR_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        localSaved = parsed;
      }
    }
  } catch (e) {}

  if (localSaved && localSaved.length > 0) return localSaved;
  return (typeof BUILTIN_ADHKAR_DATA !== "undefined" ? BUILTIN_ADHKAR_DATA : []).map(x => ({ ...x }));
}

function applyNormalizedCorpusToState(corpusObj) {
  const ayat = Array.isArray(corpusObj?.ayat) ? corpusObj.ayat : [];
  const hadiths = Array.isArray(corpusObj?.hadiths) ? corpusObj.hadiths : [];
  const adhkar = mergeAdhkarPreservingUserEdits();

  RAW_QURAN_DATA = ayat;
  RAW_HADITH_DATA = hadiths;
  DEFAULT_HADITH_DATA = hadiths;   // kept so switching back from another hadith corpus needs no reload
  RAW_ADHKAR_DATA = adhkar;

  if (Array.isArray(corpusObj?.outsideHadiths) && !RAW_OUTSIDE_HADITH_DATA.length) {
    RAW_OUTSIDE_HADITH_DATA = corpusObj.outsideHadiths;
  }

  if (typeof currentState === "object" && currentState) {
    currentState.corpus = {
      ayat: RAW_QURAN_DATA,
      hadiths: RAW_HADITH_DATA,
      adhkar: RAW_ADHKAR_DATA,
      loadedAt: corpusObj?.loadedAt || new Date().toISOString(),
      sourceSummary: corpusObj?.sourceSummary || "Dynamic Remote Corpus"
    };
  }
  if (typeof window.state === "object" && window.state) {
    window.state.corpus = currentState.corpus;
  }

  if (typeof rebuildSurahNameLookup === "function") {
    rebuildSurahNameLookup();
  }
  if (typeof rebuildMatcher === "function") {
    rebuildMatcher();
  }
  if (typeof renderDatasetsSection === "function") {
    renderDatasetsSection();
  }
  if (typeof updateFnStudioSuggestions === "function") {
    updateFnStudioSuggestions();
  }
}

async function fetchJsonSafely(url) {
  const resp = await fetch(url, { trapError: false });
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status} from ${url}`);
  }
  return await resp.json();
}

async function downloadAllCorporaFromRemote(force = false) {
  if (typeof logWahyAction === "function") {
    logWahyAction("CORPUS_DOWNLOAD_START", { force });
  }

  const cfg = getCorpusEndpointsConfig();
  updateCorpusProgressUI(6, "جاري الاتصال بخوادم القرآن الكريم...", true);

  let ayat = [];
  let hadiths = [];
  let adhkar = [];
  const errors = [];

  // 1. Check Custom Unified Corpus URL
  if (cfg.customCorpusJsonUrl && cfg.customCorpusJsonUrl.trim()) {
    try {
      updateCorpusProgressUI(14, "جاري تحميل قاعدة البيانات المخصصة...", true);
      const customData = await fetchJsonSafely(cfg.customCorpusJsonUrl.trim());
      if (Array.isArray(customData.ayat) || Array.isArray(customData.quran)) {
        ayat = customData.ayat || customData.quran;
      }
      if (Array.isArray(customData.hadiths)) {
        hadiths.push(...normalizeHadithPayload(customData.hadiths, "Custom", "مجموعة مخصصة"));
      }
      if (Array.isArray(customData.adhkar)) {
        adhkar.push(...normalizeAdhkarPayload(customData.adhkar));
      }
    } catch (customErr) {
      errors.push(`Custom Corpus URL Error: ${customErr.message}`);
    }
  }

  // 2. Fetch Quran
  if (!ayat.length) {
    try {
      updateCorpusProgressUI(22, "جاري تحميل المصحف العثماني والنص القياسي (6236 آية)...", true);
      const [uthmaniRes, simpleRes] = await Promise.all([
        fetchJsonSafely(cfg.quranUthmaniUrl),
        fetchJsonSafely(cfg.quranSimpleUrl).catch(() => null)
      ]);
      updateCorpusProgressUI(45, "جاري فهرسة الآيات القرآنية...", true);
      ayat = normalizeQuranDatasets(uthmaniRes, simpleRes, null);
    } catch (qErr) {
      errors.push(`AlQuran Cloud API: ${qErr.message}`);
      try {
        updateCorpusProgressUI(32, "جاري التحميل من المرآة الاحتياطية للقرآن الكريم...", true);
        const fbRes = await fetchJsonSafely(cfg.quranFallbackUrl);
        ayat = normalizeQuranDatasets(null, null, fbRes);
      } catch (fbErr) {
        errors.push(`Quran Fallback CDN: ${fbErr.message}`);
      }
    }
  }

  // 3. Fetch Hadith Mirrors
  updateCorpusProgressUI(55, "جاري تحميل دواوين السنة النبوية...", true);
  const mirrors = Array.isArray(cfg.hadithMirrors) ? cfg.hadithMirrors : DEFAULT_CORPUS_ENDPOINTS.hadithMirrors;
  for (let i = 0; i < mirrors.length; i++) {
    const m = mirrors[i];
    const prog = 55 + Math.round(((i + 1) / mirrors.length) * 24);
    updateCorpusProgressUI(prog, `جاري تحميل ${m.title}...`, true);
    try {
      const hJson = await fetchJsonSafely(m.url);
      const parsedH = normalizeHadithPayload(hJson, m.key, m.title);
      hadiths.push(...parsedH);
    } catch (hErr) {
      errors.push(`Hadith (${m.key}): ${hErr.message}`);
    }
  }

  // Adhkar are no longer downloaded: the built-in essentials plus the user's own additions are used
  const finalAdhkar = mergeAdhkarPreservingUserEdits(adhkar);

  if (!ayat.length && !hadiths.length) {
    updateCorpusProgressUI(100, `وضع العمل بدون اتصال (قاعدة الأذكار المدمجة جاهزة: ${finalAdhkar.length} ذكر)`, false);
    applyNormalizedCorpusToState({
      version: "2.1",
      loadedAt: new Date().toISOString(),
      sourceSummary: "Built-in Adhkar Seed (Offline)",
      ayat: [],
      hadiths: [],
      adhkar: finalAdhkar
    });
    return null;
  }

  updateCorpusProgressUI(95, "جاري حفظ القواعد المفهرسة في ذاكرة المتصفح...", true);
  const normalizedCorpus = {
    version: "2.1",
    loadedAt: new Date().toISOString(),
    sourceSummary: "AlQuran Cloud + Hadith API Mirrors + Adhkar Studio",
    ayat,
    hadiths,
    adhkar: finalAdhkar,
    outsideHadiths: RAW_OUTSIDE_HADITH_DATA
  };

  await writeCorpusToWahyDB(normalizedCorpus, CORPUS_CACHE_KEY);

  fetch("/api/corpus/cache", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      loadedAt: normalizedCorpus.loadedAt,
      counts: { ayat: ayat.length, hadiths: hadiths.length, adhkar: finalAdhkar.length }
    }),
    trapError: false
  }).catch(() => {});

  applyNormalizedCorpusToState(normalizedCorpus);
  updateCorpusProgressUI(
    100,
    `اكتمل التحميل: ${ayat.length} آية | ${hadiths.length} حديث | ${finalAdhkar.length} ذكر`,
    false
  );

  if (typeof showToast === "function") {
    showToast(`✅ القواعد جاهزة (${ayat.length} آية، ${hadiths.length} حديث، ${finalAdhkar.length} ذكر)`);
  }

  if (typeof currentState === "object" && currentState.rawTranscript) {
    if (typeof runDetectionAndBuildCaptions === "function") {
      runDetectionAndBuildCaptions();
    }
  }

  return normalizedCorpus;
}

// The project's own corpus (data/corpus.json, fetched by run.sh from the Wahy-Finder repo) is the primary source.
// Hadith of the default corpus (data/corpus.json or the download), whatever hadith corpus is currently selected
let DEFAULT_HADITH_DATA = [];

const LOCAL_CORPUS_URL = "/data/corpus.json";
const LOCAL_CORPUS_SOURCE = "local:data/corpus.json";

/** Load data/corpus.json if the server has it. Returns the normalized corpus, or null when the file is absent. */
async function loadLocalProjectCorpus() {
  let head;
  try {
    head = await fetch(LOCAL_CORPUS_URL, { method: "HEAD", trapError: false });
  } catch (e) {
    return null;
  }
  if (!head.ok) return null;
  const stamp = `${head.headers.get("content-length") || ""}|${head.headers.get("last-modified") || ""}`;

  // the browser cache already holds this exact file: no need to parse 90 MB again
  const cached = await readCorpusFromWahyDB(CORPUS_CACHE_KEY);
  if (cached && cached.sourceSummary === LOCAL_CORPUS_SOURCE && cached.localStamp === stamp && cached.ayat?.length) {
    return cached;
  }

  updateCorpusProgressUI(30, "جاري تحميل قاعدة البيانات المحلية (data/corpus.json)...", true);
  const raw = await fetchJsonSafely(LOCAL_CORPUS_URL);
  const corpus = {
    ayat: Array.isArray(raw.ayat) ? raw.ayat : [],
    hadiths: Array.isArray(raw.hadiths) ? raw.hadiths : [],
    adhkar: Array.isArray(raw.adhkar) ? raw.adhkar : [],
    loadedAt: new Date().toISOString(),
    sourceSummary: LOCAL_CORPUS_SOURCE,
    localStamp: stamp,
    version: raw.version || ""
  };
  if (!corpus.ayat.length) return null;
  await writeCorpusToWahyDB(corpus, CORPUS_CACHE_KEY);
  return corpus;
}

async function initDynamicCorpus(forceDownload = false) {
  const result = await loadDefaultCorpus(forceDownload);
  // then switch to the hadith corpus the user selected, if it isn't the default one
  if (typeof applySavedHadithCorpusChoice === "function") await applySavedHadithCorpusChoice();
  return result;
}

async function loadDefaultCorpus(forceDownload = false) {
  // Always ensure built-in/custom Adhkar are indexed right away before network finishes
  rebuildMatcher();

  try {
    const local = await loadLocalProjectCorpus();
    if (local) {
      applyNormalizedCorpusToState(local);
      updateCorpusProgressUI(100, `القاعدة المحلية: ${local.ayat.length} آية | ${local.hadiths.length} حديث | ${RAW_ADHKAR_DATA.length} ذكر`, false);
      if (typeof logWahyAction === "function") {
        logWahyAction("CORPUS_LOADED_LOCAL_FILE", { ayat: local.ayat.length, hadiths: local.hadiths.length, adhkar: RAW_ADHKAR_DATA.length });
      }
      return local;
    }
  } catch (err) {
    console.error("Local data/corpus.json failed to load, falling back to cache/remote", err);
  }

  if (!forceDownload) {
    updateCorpusProgressUI(25, "جاري فحص القواعد المحفوظة محلياً...", true);
    const cached = await readCorpusFromWahyDB(CORPUS_CACHE_KEY);
    if (cached && Array.isArray(cached.ayat) && cached.ayat.length > 0) {
      applyNormalizedCorpusToState(cached);
      updateCorpusProgressUI(
        100,
        `تم الاسترجاع الفوري: ${cached.ayat.length} آية | ${(cached.hadiths || []).length} حديث | ${RAW_ADHKAR_DATA.length} ذكر`,
        false
      );
      if (typeof logWahyAction === "function") {
        logWahyAction("CORPUS_LOADED_FROM_IDB", {
          ayat: cached.ayat.length,
          hadiths: (cached.hadiths || []).length,
          adhkar: RAW_ADHKAR_DATA.length
        });
      }
      return cached;
    }
  }
  return await downloadAllCorporaFromRemote(forceDownload);
}

async function clearAndRedownloadCorpus() {
  if (typeof logWahyAction === "function") {
    logWahyAction("CORPUS_CLEAR_AND_REDOWNLOAD", "User triggered Clear & Re-download Corpus");
  }
  updateCorpusProgressUI(5, "جاري مسح الذاكرة المؤقتة وإعادة التحميل من المصدر...", true);
  await clearWahyCorpusDB();
  RAW_QURAN_DATA = [];
  RAW_HADITH_DATA = [];
  return await downloadAllCorporaFromRemote(true);
}

function searchCorpusUnits(query, categoryFilter = "ALL", limit = 30) {
  if (!activeMatcher || !activeMatcher.units) return [];
  const qRaw = String(query || "").trim();
  const qNorm = typeof normalizeArabic === "function" ? normalizeArabic(qRaw) : qRaw;
  const results = [];

  for (const unit of activeMatcher.units.values()) {
    if (categoryFilter !== "ALL") {
      if (categoryFilter === "ayah" && unit.sourceType !== "QURAN") continue;
      if (categoryFilter === "hadith" && unit.sourceType !== "HADITH") continue;
      if (categoryFilter === "dhikr" && unit.sourceType !== "ADHKAR") continue;
      if (["QURAN", "HADITH", "ADHKAR"].includes(categoryFilter) && unit.sourceType !== categoryFilter) continue;
    }
    if (!qNorm) {
      results.push(unit);
      if (results.length >= limit) break;
      continue;
    }
    const normJoined = (unit.normWords || []).join(" ");
    const refMatch = String(unit.displayRef || "").includes(qRaw) || String(unit.unitId || "").toLowerCase().includes(qRaw.toLowerCase());
    if (refMatch || normJoined.includes(qNorm) || String(unit.fullText || "").includes(qRaw)) {
      results.push(unit);
      if (results.length >= limit) break;
    }
  }
  return results;
}

window.WahyCorpusLoader = {
  initDynamicCorpus,
  clearAndRedownloadCorpus,
  downloadAllCorporaFromRemote,
  getCorpusEndpointsConfig,
  saveCorpusEndpointsConfig,
  searchCorpusUnits,
  applyNormalizedCorpusToState,
  writeCorpusToWahyDB
};
