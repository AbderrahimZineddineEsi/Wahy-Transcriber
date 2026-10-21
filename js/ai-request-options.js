// =============================================================================
// Wahy Studio — AI Request Options Panel
// File: js/ai-request-options.js
// One modal shared by the Display toolbar (batch mode: findings selection,
// model, prompt) and the Editor Inspector (single mode: model, prompt for one
// finding). Every change is applied live to currentState.aiVerification and
// persisted, so the next request (from anywhere) uses it.
// =============================================================================

const aiOptsState = {
  mode: "batch",        // "batch" | "single"
  findingIdx: -1,       // single mode target
  tab: "selection",     // "selection" | "model" | "prompt"
  manualFilter: "",
  showJson: false
};

const AI_PROVIDER_CARDS = [
  { id: "gemini", icon: "✨", name: "Google Gemini", desc: "سريع ومجاني ضمن حدود الخطة المجانية، يدقق عدة مقتبسات في طلب واحد.", tags: ["مجاني", "دفعات"] },
  { id: "openrouter_jev", icon: "🎯", name: "OpenRouter — JEV", desc: "نموذج قرارات مخصص يرجع احتمالات معايرة، رخيص جداً. لا يكتب تعليلاً.", tags: ["رخيص جداً", "احتمالات"] },
  { id: "openrouter_chat", icon: "💬", name: "OpenRouter — Chat", desc: "أي نموذج محادثة (DeepSeek, Qwen, Claude, GPT...). الأكثر مرونة في الموجّه.", tags: ["مرن", "تعليل مفصل"] },
  { id: "local_laya", icon: "🖥️", name: "Laya المحلي", desc: "يعمل على جهازك بلا إنترنت. نموذج مدرّب على صيغة ثابتة فلا يتأثر بتعديل الموجّه.", tags: ["محلي", "بلا تكلفة"] }
];

const GEMINI_MODEL_OPTIONS = [
  { id: "gemini-3.5-flash-lite", label: "gemini-3.5-flash-lite — الأحدث والأدق (موصى به)" },
  { id: "gemini-3.1-flash-lite", label: "gemini-3.1-flash-lite" },
  { id: "gemini-3.8-flash", label: "gemini-3.8-flash — الأعلى قدرة" },
  { id: "gemini-2.5-flash-lite", label: "gemini-2.5-flash-lite" }
];

const JEV_MODEL_OPTIONS = [
  { id: "typesafe/jev-1.14", label: "typesafe/jev-1.14 — موصى به" },
  { id: "~typesafe/jev-latest", label: "~typesafe/jev-latest" },
  { id: "typesafe/jev-1.13", label: "typesafe/jev-1.13" }
];

const CHAT_MODEL_QUICK_PICKS = [
  "deepseek/deepseek-chat",
  "qwen/qwen-2.5-72b-instruct",
  "google/gemini-2.5-flash",
  "anthropic/claude-sonnet-4.5",
  "openai/gpt-4o-mini"
];

const PROMPT_SNIPPETS = [
  { label: "الشيخ يقرأ من كتاب", text: "الشيخ يقرأ من كتاب شرح؛ قراءة نص الكتاب نفسه كلام عادي ما لم يكن آية أو حديثاً." },
  { label: "المحاضرة بالعامية", text: "المحاضرة باللهجة العامية؛ الصياغة العامية حول النص لا تنفي كونه اقتباساً." },
  { label: "الأذكار القصيرة الشائعة", text: "العبارات القصيرة الشائعة (سبحان الله، الحمد لله، إن شاء الله) داخل الكلام العادي ليست اقتباساً لذكر مأثور." },
  { label: "الآيات بلا تمهيد", text: "الآيات المتلوّة بنبرة التلاوة تُعد اقتباساً حتى لو لم يسبقها «قال تعالى»." },
  { label: "الدعاء في آخر الدرس", text: "الدعاء في ختام الدرس إذا طابق ذكراً مأثوراً فهو اقتباس صحيح." }
];

const SCOPE_OPTIONS = [
  { id: "HADITH_AND_CANDIDATES", label: "الأحاديث والمشتبه به", hint: "الأحاديث + أي مقتبس ثقة المحرك فيه منخفضة. موصى به." },
  { id: "HADITH_ONLY", label: "الأحاديث فقط", hint: "الأحاديث النبوية هي الأكثر عرضة للإيجابيات الكاذبة." },
  { id: "ALL", label: "جميع المقتبسات", hint: "قرآن + حديث + أذكار. الأشمل والأعلى تكلفة." }
];

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function aiOptsCfg() {
  return WahyAiVerifier.getPromptConfig();
}

function setAiPromptConfig(patch) {
  const next = Object.assign({}, aiOptsCfg(), patch);
  if (patch.rules) next.rules = Object.assign({}, aiOptsCfg().rules, patch.rules);
  currentState.aiVerification.promptConfig = next;
  saveAiConfigToStorage();
}

function aiOptsSampleIdx() {
  if (aiOptsState.mode === "single") return aiOptsState.findingIdx;
  const targets = WahyAiVerifier.resolveTargetIndices();
  if (targets.length) return targets[0];
  const sel = currentState.selectedPredIndex;
  return (sel >= 0 && sel < currentState.detections.length) ? sel : (currentState.detections.length ? 0 : -1);
}

function aiDetCategory(d) {
  const st = (d.sourceType || "").toUpperCase();
  if (st === "QURAN" || d.type === "ayah") return "quran";
  if (st === "HADITH" || d.type === "hadith") return "hadith";
  return "dhikr";
}

function aiVerdictBadge(d) {
  const ai = d.aiVerification || {};
  if (ai.status === "VERIFIED") {
    if (ai.verdict === "CORRECT") return '<span class="text-emerald-400">🟢</span>';
    if (ai.verdict === "FALSE") return '<span class="text-rose-400">🔴</span>';
    return '<span class="text-amber-400">🟡</span>';
  }
  if (ai.status === "ERROR") return '<span title="فشل الفحص">⚠️</span>';
  return '<span class="text-slate-600" title="غير مفحوص">⚪</span>';
}

function aiProviderHasKey(provider) {
  const ai = currentState.aiVerification;
  if (provider === "gemini") return Boolean((ai.geminiApiKey || "").trim());
  if (provider === "openrouter_jev" || provider === "openrouter_chat") return Boolean((ai.openRouterApiKey || "").trim());
  return true;
}

/** Keep the AI Studio settings inputs in sync with changes made from this panel. */
function syncAiSettingsInputs() {
  const ai = currentState.aiVerification;
  const set = (id, prop, val) => { const el = document.getElementById(id); if (el) el[prop] = val; };
  set("selAiQuickProvider", "value", ai.activeProvider);
  set("selGeminiModel", "value", ai.geminiModel);
  set("selOpenRouterJevModel", "value", ai.openRouterJevModel);
  set("lblOpenRouterSelectedModelDisplay", "textContent", ai.openRouterSelectedModel);
  set("inpGeminiBatchSize", "value", ai.geminiBatchSize);
  set("chkGeminiFreeTierMode", "checked", ai.geminiFreeTierMode !== false);
}

function updateAiLaunchButtonLabel() {
  const lbl = document.getElementById("lblAiLaunchTargetCount");
  if (!lbl || typeof WahyAiVerifier !== "object") return;
  const n = WahyAiVerifier.resolveTargetIndices().length;
  lbl.textContent = String(n);
  const btn = document.getElementById("btnStartAiVerification");
  if (btn) {
    btn.title = currentState.aiVerification.selectionMode === "manual"
      ? `تدقيق ${n} مقتبس مختار يدوياً`
      : `تدقيق ${n} مقتبس ضمن النطاق المحدد`;
  }
}

function refreshAiOptsFooter() {
  const indices = aiOptsState.mode === "single" ? [aiOptsState.findingIdx] : null;
  const est = WahyAiVerifier.estimateBatchVerification(indices);
  const set = (id, txt) => { const el = document.getElementById(id); if (el) el.textContent = txt; };
  set("lblEstQuotesCount", est.count);
  set("lblEstTokensCount", `~${est.approxTokens.toLocaleString("en")}`);
  set("lblEstCostUsd", `$${est.estCost.toFixed(4)}`);
  set("lblEstDurationSec", `~${est.estSeconds} ث`);

  const launch = document.getElementById("btnAiOptsLaunch");
  if (launch) {
    launch.disabled = est.count === 0;
    launch.textContent = aiOptsState.mode === "single" ? "🚀 تدقيق هذا المقتبس" : `🚀 بدء التدقيق (${est.count})`;
  }
  updateAiLaunchButtonLabel();
}

// -----------------------------------------------------------------------------
// Open / close / tabs
// -----------------------------------------------------------------------------

function openAiRequestOptions({ mode = "batch", findingIdx = -1, tab = null } = {}) {
  const modal = document.getElementById("modalAiRequestOptions");
  if (!modal) return;
  if (!currentState.detections.length) {
    showToast("⚠️ لا توجد مقتبسات مكتشفة بعد.");
    return;
  }
  aiOptsState.mode = mode;
  aiOptsState.findingIdx = findingIdx;
  aiOptsState.tab = tab || (mode === "single" ? "model" : "selection");
  aiOptsState.manualFilter = "";
  aiOptsState.showJson = false;

  const sub = document.getElementById("lblAiOptsSubtitle");
  if (sub) {
    const det = currentState.detections[findingIdx];
    sub.textContent = mode === "single" && det
      ? `للمقتبس: ${det.displayRef || det.reference || "مقتبس"} — تُحفظ إعدادات النموذج والموجّه لكل الطلبات القادمة`
      : "حدد المقتبسات، واختر النموذج، واضبط الموجّه ثم ابدأ";
  }

  modal.classList.remove("hidden");
  modal.classList.add("flex");
  renderAiOptsTabs();
}

function closeAiRequestOptions() {
  const modal = document.getElementById("modalAiRequestOptions");
  if (!modal) return;
  modal.classList.add("hidden");
  modal.classList.remove("flex");
  updateAiLaunchButtonLabel();
  if (typeof renderFindingInspector === "function") renderFindingInspector();
}

function renderAiOptsTabs() {
  const bar = document.getElementById("aiOptsTabBar");
  if (!bar) return;
  const tabs = [
    ...(aiOptsState.mode === "batch" ? [{ id: "selection", label: "📋 المقتبسات" }] : []),
    { id: "model", label: "🧠 النموذج" },
    { id: "prompt", label: "✍️ الموجّه (Prompt)" }
  ];
  bar.innerHTML = tabs.map(t => `
    <button type="button" data-ai-opts-tab="${t.id}" class="px-3 py-1.5 rounded-xl font-bold border transition ${
      aiOptsState.tab === t.id
        ? "bg-sky-600/25 text-sky-200 border-sky-500/50"
        : "bg-slate-950 text-slate-400 border-slate-800 hover:text-slate-200"
    }">${t.label}</button>
  `).join("");
  bar.querySelectorAll("[data-ai-opts-tab]").forEach(btn => {
    btn.addEventListener("click", () => {
      aiOptsState.tab = btn.getAttribute("data-ai-opts-tab");
      renderAiOptsTabs();
    });
  });

  const body = document.getElementById("aiOptsBody");
  if (body) body.scrollTop = 0;
  if (aiOptsState.tab === "selection") renderAiOptsSelectionTab();
  else if (aiOptsState.tab === "model") renderAiOptsModelTab();
  else renderAiOptsPromptTab();
  refreshAiOptsFooter();
}

// -----------------------------------------------------------------------------
// Tab 1: Findings selection (batch only)
// -----------------------------------------------------------------------------

function renderAiOptsSelectionTab() {
  const body = document.getElementById("aiOptsBody");
  const ai = currentState.aiVerification;
  const dets = currentState.detections;
  const isManual = ai.selectionMode === "manual";

  const modeCard = (id, icon, title, hint) => `
    <button type="button" data-sel-mode="${id}" class="text-right p-3 rounded-xl border transition ${
      (ai.selectionMode || "scope") === id ? "bg-sky-950/60 border-sky-500/60" : "bg-slate-950 border-slate-800 hover:border-slate-600"
    }">
      <div class="font-bold text-slate-100">${icon} ${title}</div>
      <div class="text-[11px] text-slate-400 mt-0.5">${hint}</div>
    </button>`;

  let inner = "";
  if (!isManual) {
    inner = `<div class="space-y-1.5">` + SCOPE_OPTIONS.map(o => {
      const saved = ai.targetScope;
      ai.targetScope = o.id;
      const n = WahyAiVerifier.resolveTargetIndices().length;
      ai.targetScope = saved;
      const active = (ai.targetScope || "HADITH_AND_CANDIDATES") === o.id;
      return `
        <label class="flex items-center justify-between gap-2 p-2.5 rounded-xl border cursor-pointer transition ${active ? "bg-slate-950 border-emerald-500/50" : "bg-slate-950/60 border-slate-800 hover:border-slate-600"}">
          <span class="flex items-center gap-2">
            <input type="radio" name="aiOptsScope" value="${o.id}" ${active ? "checked" : ""} class="accent-emerald-500" />
            <span>
              <span class="font-bold text-slate-200 block">${o.label}</span>
              <span class="text-[11px] text-slate-400">${o.hint}</span>
            </span>
          </span>
          <span class="font-mono text-sky-300 shrink-0">${n} مقتبس</span>
        </label>`;
    }).join("") + `</div>`;
  } else {
    const picked = new Set(ai.manualSelectedIds || []);
    const q = aiOptsState.manualFilter.trim();
    const rows = dets.map((d, i) => ({ d, i })).filter(({ d }) => {
      if (!q) return true;
      return (d.displayRef || d.reference || "").includes(q) || (d.matchedText || "").includes(q);
    });
    const quick = [
      ["all", "الكل"], ["none", "لا شيء"], ["invert", "عكس التحديد"],
      ["quran", "القرآن"], ["hadith", "الحديث"], ["dhikr", "الأذكار"],
      ["unverified", "غير المفحوصة"], ["lowconf", "ثقة منخفضة"], ["false", "المستبعدة 🔴"], ["notsure", "غير المتأكدة 🟡"]
    ];
    inner = `
      <div class="flex flex-wrap items-center gap-1.5">
        <input type="search" id="inpAiOptsFilter" value="${escapeHtml(aiOptsState.manualFilter)}" placeholder="🔎 بحث بالمرجع أو النص..." class="flex-1 min-w-[160px] rounded-lg bg-slate-950 border border-slate-800 px-2.5 py-1.5 text-slate-200 focus:outline-none focus:border-sky-500" />
        <span class="text-[11px] text-slate-400">محدد <strong id="lblAiOptsPickedCount" class="text-sky-300 font-mono">${picked.size}</strong> من ${dets.length}</span>
      </div>
      <div class="flex flex-wrap gap-1.5">
        ${quick.map(([id, label]) => `<button type="button" data-quick-pick="${id}" class="px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200">${label}</button>`).join("")}
      </div>
      <div class="text-[10px] text-slate-500">أزرار التصنيف تضيف إلى التحديد الحالي؛ استخدم «لا شيء» أولاً لتبدأ من الصفر.</div>
      <div class="space-y-1 max-h-72 overflow-y-auto pr-1">
        ${rows.map(({ d, i }) => `
          <label class="flex items-center justify-between gap-2 p-2 rounded-xl bg-slate-950/80 border border-slate-800 hover:border-slate-700 cursor-pointer">
            <span class="flex items-center gap-2 overflow-hidden">
              <input type="checkbox" class="chkAiOptsPick accent-emerald-500" data-det-id="${escapeHtml(String(d.id))}" ${picked.has(d.id) ? "checked" : ""} />
              ${aiVerdictBadge(d)}
              <span class="font-bold text-slate-200 truncate shrink-0 max-w-[40%]">${escapeHtml(d.displayRef || d.reference || "مقتبس")}</span>
              <span class="font-arabic-text text-slate-400 truncate">«${escapeHtml(d.matchedText || "")}»</span>
            </span>
            <span class="font-mono text-[10px] text-slate-500 shrink-0">${formatSecondsToShortTime(d.startTime)}</span>
          </label>`).join("") || '<div class="text-center text-slate-500 py-4">لا نتائج مطابقة للبحث.</div>'}
      </div>`;
  }

  body.innerHTML = `
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
      ${modeCard("scope", "📐", "حسب النطاق", "يختار تلقائياً كل مقتبس يطابق النطاق، ويتحدّث مع أي تعديل على المقتبسات.")}
      ${modeCard("manual", "✋", "اختيار يدوي", "أنت تحدد المقتبسات واحداً واحداً. مفيد لإعادة فحص بضعة مقتبسات فقط.")}
    </div>
    ${inner}
  `;

  body.querySelectorAll("[data-sel-mode]").forEach(btn => {
    btn.addEventListener("click", () => {
      const m = btn.getAttribute("data-sel-mode");
      if (m === "manual" && ai.selectionMode !== "manual" && !(ai.manualSelectedIds || []).length) {
        // Start the manual pick from what the scope would have chosen
        ai.manualSelectedIds = WahyAiVerifier.resolveTargetIndices().map(i => dets[i].id);
      }
      ai.selectionMode = m;
      renderAiOptsSelectionTab();
      refreshAiOptsFooter();
    });
  });

  body.querySelectorAll('input[name="aiOptsScope"]').forEach(r => {
    r.addEventListener("change", () => {
      ai.targetScope = r.value;
      saveAiConfigToStorage();
      renderAiOptsSelectionTab();
      refreshAiOptsFooter();
    });
  });

  const filterInp = body.querySelector("#inpAiOptsFilter");
  filterInp?.addEventListener("input", () => {
    aiOptsState.manualFilter = filterInp.value;
    const pos = filterInp.selectionStart;
    renderAiOptsSelectionTab();
    const again = document.getElementById("inpAiOptsFilter");
    if (again) { again.focus(); again.setSelectionRange(pos, pos); }
  });

  body.querySelectorAll(".chkAiOptsPick").forEach(cb => {
    cb.addEventListener("change", () => {
      const id = cb.getAttribute("data-det-id");
      const det = dets.find(d => String(d.id) === id);
      if (!det) return;
      const picked = new Set(ai.manualSelectedIds || []);
      if (cb.checked) picked.add(det.id); else picked.delete(det.id);
      ai.manualSelectedIds = Array.from(picked);
      const cnt = document.getElementById("lblAiOptsPickedCount");
      if (cnt) cnt.textContent = String(picked.size);
      refreshAiOptsFooter();
    });
  });

  body.querySelectorAll("[data-quick-pick]").forEach(btn => {
    btn.addEventListener("click", () => {
      const kind = btn.getAttribute("data-quick-pick");
      let picked = new Set(ai.manualSelectedIds || []);
      const match = {
        quran: d => aiDetCategory(d) === "quran",
        hadith: d => aiDetCategory(d) === "hadith",
        dhikr: d => aiDetCategory(d) === "dhikr",
        unverified: d => (d.aiVerification?.status !== "VERIFIED"),
        lowconf: d => ((d.totalScore || 0) < 15 || d.confidenceBand === "CANDIDATE"),
        false: d => d.aiVerification?.verdict === "FALSE",
        notsure: d => d.aiVerification?.verdict === "NOT_SURE"
      };
      if (kind === "all") picked = new Set(dets.map(d => d.id));
      else if (kind === "none") picked = new Set();
      else if (kind === "invert") picked = new Set(dets.filter(d => !picked.has(d.id)).map(d => d.id));
      else if (match[kind]) dets.filter(match[kind]).forEach(d => picked.add(d.id));
      ai.manualSelectedIds = Array.from(picked);
      renderAiOptsSelectionTab();
      refreshAiOptsFooter();
    });
  });
}

// -----------------------------------------------------------------------------
// Tab 2: Provider & model
// -----------------------------------------------------------------------------

function renderAiOptsModelTab() {
  const body = document.getElementById("aiOptsBody");
  const ai = currentState.aiVerification;
  const prov = ai.activeProvider || "gemini";
  const cfg = aiOptsCfg();
  const tempSupported = prov === "gemini" || prov === "openrouter_chat";

  const cards = AI_PROVIDER_CARDS.map(c => `
    <button type="button" data-provider="${c.id}" class="text-right p-3 rounded-xl border transition ${
      prov === c.id ? "bg-sky-950/60 border-sky-500/60" : "bg-slate-950 border-slate-800 hover:border-slate-600"
    }">
      <div class="flex items-center justify-between gap-2">
        <span class="font-bold text-slate-100">${c.icon} ${c.name}</span>
        ${aiProviderHasKey(c.id) ? "" : '<span class="text-[10px] text-amber-400">🔑 بلا مفتاح</span>'}
      </div>
      <div class="text-[11px] text-slate-400 mt-1 leading-relaxed">${c.desc}</div>
      <div class="flex gap-1 mt-1.5">${c.tags.map(t => `<span class="px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 text-[10px]">${t}</span>`).join("")}</div>
    </button>`).join("");

  let modelHtml = "";
  if (prov === "gemini") {
    const known = GEMINI_MODEL_OPTIONS.some(m => m.id === ai.geminiModel);
    modelHtml = `
      <label class="block space-y-1">
        <span class="text-slate-300 font-semibold">نموذج Gemini</span>
        <select id="selAiOptsGeminiModel" class="w-full rounded-xl bg-slate-950 border border-slate-800 px-3 py-1.5 text-slate-200">
          ${GEMINI_MODEL_OPTIONS.map(m => `<option value="${m.id}" ${ai.geminiModel === m.id ? "selected" : ""}>${m.label}</option>`).join("")}
          <option value="__custom" ${known ? "" : "selected"}>نموذج آخر (اكتب الاسم)…</option>
        </select>
      </label>
      <input type="text" id="inpAiOptsGeminiCustom" value="${known ? "" : escapeHtml(ai.geminiModel || "")}" placeholder="مثال: gemini-3.8-pro" class="${known ? "hidden" : ""} w-full rounded-xl bg-slate-950 border border-slate-800 px-3 py-1.5 text-slate-200 font-mono" dir="ltr" />
      <div class="grid grid-cols-2 gap-2">
        <label class="block space-y-1">
          <span class="text-slate-300 font-semibold">حجم الدفعة</span>
          <input type="number" id="inpAiOptsGeminiBatch" min="1" max="10" value="${ai.geminiBatchSize || 5}" class="w-full rounded-xl bg-slate-950 border border-slate-800 px-3 py-1.5 text-slate-200 font-mono" />
          <span class="text-[10px] text-slate-500 block">عدد المقتبسات في كل طلب. أقل = أدق، أكثر = أسرع وأوفر.</span>
        </label>
        <label class="flex items-start gap-2 p-2.5 rounded-xl bg-slate-950 border border-slate-800 cursor-pointer">
          <input type="checkbox" id="chkAiOptsGeminiFree" ${ai.geminiFreeTierMode !== false ? "checked" : ""} class="mt-0.5 accent-sky-500" />
          <span>
            <span class="font-semibold text-slate-200 block">وضع الخطة المجانية</span>
            <span class="text-[10px] text-slate-500"><span>يبطئ الطلبات تلقائياً لتجنب خطأ 429.</span> <span class="font-mono">${ai.geminiRpmLimit || 12} RPM</span></span>
          </span>
        </label>
      </div>`;
  } else if (prov === "openrouter_jev") {
    modelHtml = `
      <label class="block space-y-1">
        <span class="text-slate-300 font-semibold">نموذج JEV</span>
        <select id="selAiOptsJevModel" class="w-full rounded-xl bg-slate-950 border border-slate-800 px-3 py-1.5 text-slate-200">
          ${JEV_MODEL_OPTIONS.map(m => `<option value="${m.id}" ${ai.openRouterJevModel === m.id ? "selected" : ""}>${m.label}</option>`).join("")}
        </select>
      </label>
      <div class="p-2.5 rounded-xl bg-indigo-950/40 border border-indigo-500/30 text-[11px] text-indigo-200">
        JEV لا يقبل موجّه نظام ولا يكتب تعليلاً؛ لكن تعليمات الحكم والقواعد من تبويب «الموجّه» تُرسل له ضمن الأسئلة.
      </div>`;
  } else if (prov === "openrouter_chat") {
    const catalog = ai.openRouterModelsCatalog || [];
    const meta = catalog.find(m => m.id === ai.openRouterSelectedModel);
    modelHtml = `
      <label class="block space-y-1">
        <span class="text-slate-300 font-semibold">معرّف النموذج على OpenRouter</span>
        <input type="text" id="inpAiOptsChatModel" list="dlAiOptsChatModels" value="${escapeHtml(ai.openRouterSelectedModel || "")}" placeholder="provider/model" class="w-full rounded-xl bg-slate-950 border border-slate-800 px-3 py-1.5 text-slate-200 font-mono" dir="ltr" />
        <datalist id="dlAiOptsChatModels">${catalog.slice(0, 400).map(m => `<option value="${escapeHtml(m.id)}">${escapeHtml(m.name)}</option>`).join("")}</datalist>
      </label>
      <div class="flex flex-wrap items-center gap-1.5">
        <span class="text-[11px] text-slate-400">اختيار سريع:</span>
        ${CHAT_MODEL_QUICK_PICKS.map(id => `<button type="button" data-chat-pick="${id}" class="px-2 py-0.5 rounded-lg font-mono text-[10px] border ${ai.openRouterSelectedModel === id ? "bg-indigo-600/30 text-indigo-200 border-indigo-500/50" : "bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700"}">${id}</button>`).join("")}
      </div>
      <div class="text-[11px] text-slate-400">
        ${meta
          ? `السعر: <span class="font-mono text-emerald-400">$${(parseFloat(meta.pricing.prompt || 0) * 1e6).toFixed(3)} / $${(parseFloat(meta.pricing.completion || 0) * 1e6).toFixed(3)}</span> لكل مليون توكن (إدخال / إخراج) • سياق ${Math.round((meta.context_length || 0) / 1024)}k`
          : catalog.length
            ? "النموذج غير موجود في قائمة OpenRouter؛ تأكد من المعرّف."
            : `<button type="button" id="btnAiOptsLoadCatalog" class="text-sky-300 underline">تحميل قائمة النماذج من OpenRouter</button> للبحث بالاسم ومعرفة الأسعار.`}
      </div>`;
  } else {
    modelHtml = `
      <div class="p-2.5 rounded-xl bg-slate-950 border border-slate-800 text-[11px] text-slate-300 space-y-1">
        <div>النقطة المحفوظة: <span class="font-mono text-sky-300">${escapeHtml(ai.layaCheckpoint || "")}</span></div>
        <div class="text-slate-500">يمكن تغيير النقطة والجهاز من استوديو AI. Laya مدرّب على صيغة الأسئلة الأصلية، لذلك لا تُطبق عليه تعديلات الموجّه.</div>
      </div>`;
  }

  body.innerHTML = `
    <div class="space-y-1.5">
      <div class="font-bold text-slate-200">المزوّد</div>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">${cards}</div>
    </div>
    ${aiProviderHasKey(prov) ? "" : `
      <div class="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-amber-950/40 border border-amber-500/40 text-amber-200">
        <span>🔑 لم يتم إدخال مفتاح API لهذا المزوّد بعد.</span>
        <button type="button" id="btnAiOptsGoKeys" class="px-2.5 py-1 rounded-lg bg-amber-600/30 hover:bg-amber-600/50 font-bold">فتح إعدادات المفاتيح</button>
      </div>`}
    <div class="space-y-2 p-3 rounded-xl bg-slate-950/60 border border-slate-800">${modelHtml}</div>
    <div class="space-y-1.5 p-3 rounded-xl bg-slate-950/60 border border-slate-800 ${tempSupported ? "" : "opacity-50"}">
      <div class="flex items-center justify-between">
        <span class="font-semibold text-slate-300">درجة الحرارة (Temperature)</span>
        <span id="lblAiOptsTemp" class="font-mono text-sky-300">${cfg.temperature.toFixed(2)}</span>
      </div>
      <input type="range" id="rngAiOptsTemp" min="0" max="1" step="0.05" value="${cfg.temperature}" ${tempSupported ? "" : "disabled"} class="w-full accent-sky-500" />
      <div class="flex justify-between text-[10px] text-slate-500"><span>0 = حكم ثابت ومتكرر (موصى به)</span><span>1 = متنوع وأقل ثباتاً</span></div>
    </div>
  `;

  body.querySelectorAll("[data-provider]").forEach(btn => {
    btn.addEventListener("click", () => {
      ai.activeProvider = btn.getAttribute("data-provider");
      saveAiConfigToStorage();
      syncAiSettingsInputs();
      renderAiOptsModelTab();
      refreshAiOptsFooter();
    });
  });

  body.querySelector("#btnAiOptsGoKeys")?.addEventListener("click", () => {
    closeAiRequestOptions();
    switchMainSection("ai_logs");
  });

  const selGem = body.querySelector("#selAiOptsGeminiModel");
  const inpGemCustom = body.querySelector("#inpAiOptsGeminiCustom");
  selGem?.addEventListener("change", () => {
    const isCustom = selGem.value === "__custom";
    inpGemCustom?.classList.toggle("hidden", !isCustom);
    if (!isCustom) {
      ai.geminiModel = selGem.value;
      saveAiConfigToStorage();
      syncAiSettingsInputs();
      refreshAiOptsFooter();
    } else {
      inpGemCustom?.focus();
    }
  });
  inpGemCustom?.addEventListener("change", () => {
    const v = inpGemCustom.value.trim();
    if (!v) return;
    ai.geminiModel = v;
    saveAiConfigToStorage();
    syncAiSettingsInputs();
  });
  body.querySelector("#inpAiOptsGeminiBatch")?.addEventListener("change", (e) => {
    ai.geminiBatchSize = Math.min(10, Math.max(1, parseInt(e.target.value, 10) || 5));
    saveAiConfigToStorage();
    syncAiSettingsInputs();
  });
  body.querySelector("#chkAiOptsGeminiFree")?.addEventListener("change", (e) => {
    ai.geminiFreeTierMode = e.target.checked;
    saveAiConfigToStorage();
    syncAiSettingsInputs();
    refreshAiOptsFooter();
  });

  body.querySelector("#selAiOptsJevModel")?.addEventListener("change", (e) => {
    ai.openRouterJevModel = e.target.value;
    saveAiConfigToStorage();
    syncAiSettingsInputs();
  });

  const inpChat = body.querySelector("#inpAiOptsChatModel");
  inpChat?.addEventListener("change", () => {
    const v = inpChat.value.trim();
    if (!v) return;
    ai.openRouterSelectedModel = v;
    saveAiConfigToStorage();
    syncAiSettingsInputs();
    renderAiOptsModelTab();
    refreshAiOptsFooter();
  });
  body.querySelectorAll("[data-chat-pick]").forEach(btn => {
    btn.addEventListener("click", () => {
      ai.openRouterSelectedModel = btn.getAttribute("data-chat-pick");
      saveAiConfigToStorage();
      syncAiSettingsInputs();
      renderAiOptsModelTab();
      refreshAiOptsFooter();
    });
  });
  body.querySelector("#btnAiOptsLoadCatalog")?.addEventListener("click", async (e) => {
    e.target.textContent = "جاري التحميل...";
    await WahyAiVerifier.fetchOpenRouterModelsCatalog(true);
    if (aiOptsState.tab === "model") renderAiOptsModelTab();
  });

  const rng = body.querySelector("#rngAiOptsTemp");
  rng?.addEventListener("input", () => {
    const lbl = document.getElementById("lblAiOptsTemp");
    if (lbl) lbl.textContent = Number(rng.value).toFixed(2);
  });
  rng?.addEventListener("change", () => setAiPromptConfig({ temperature: Number(rng.value) }));
}

// -----------------------------------------------------------------------------
// Tab 3: Prompt helper
// -----------------------------------------------------------------------------

function renderAiOptsPromptTab() {
  const body = document.getElementById("aiOptsBody");
  const ai = currentState.aiVerification;
  const prov = ai.activeProvider || "gemini";
  const cfg = aiOptsCfg();
  const presets = WahyAiVerifier.PROMPT_PRESETS;
  const rules = WahyAiVerifier.PROMPT_RULES;
  const supportsPrompt = WahyAiVerifier.providerSupportsPrompt(prov);
  const supportsSystem = prov === "gemini" || prov === "openrouter_chat";
  const ctxWords = ai.contextWindowWords || 25;

  const providerName = (AI_PROVIDER_CARDS.find(c => c.id === prov) || {}).name || prov;
  const banner = !supportsPrompt
    ? `<div class="p-2.5 rounded-xl bg-amber-950/40 border border-amber-500/40 text-amber-200">⚠️ المزوّد الحالي (${providerName}) نموذج مدرّب على صيغة ثابتة، فلن تُطبق عليه تعديلات الموجّه. بدّل المزوّد من تبويب «النموذج» لتفعيلها. (يبقى «نافذة السياق» مؤثراً.)</div>`
    : (!supportsSystem
        ? `<div class="p-2.5 rounded-xl bg-indigo-950/40 border border-indigo-500/30 text-indigo-200">ℹ️ ${providerName}: تُطبق أسلوب الحكم والقواعد والتعليمات الخاصة. لا يدعم موجّه النظام ولا لغة التعليل.</div>`
        : "");

  const section = (num, title, hint, content, extraCls = "") => `
    <div class="space-y-2 p-3 rounded-xl bg-slate-950/60 border border-slate-800 ${extraCls}">
      <div>
        <div class="font-bold text-slate-200">${num}. ${title}</div>
        ${hint ? `<div class="text-[11px] text-slate-500">${hint}</div>` : ""}
      </div>
      ${content}
    </div>`;

  const dim = supportsPrompt ? "" : "opacity-50 pointer-events-none";

  const presetsHtml = `<div class="grid grid-cols-2 sm:grid-cols-4 gap-1.5">${Object.keys(presets).map(k => `
    <button type="button" data-preset="${k}" class="text-right p-2 rounded-lg border transition ${cfg.preset === k ? "bg-emerald-950/60 border-emerald-500/60 text-emerald-200" : "bg-slate-900 border-slate-800 text-slate-300 hover:border-slate-600"}">
      <div class="font-bold">${presets[k].label}</div>
    </button>`).join("")}</div>
    <div class="text-[11px] text-slate-400">${escapeHtml((presets[cfg.preset] || presets.balanced).hint)}</div>`;

  const rulesHtml = `<div class="grid grid-cols-1 sm:grid-cols-2 gap-1.5">${Object.keys(rules).map(k => `
    <label class="flex items-start gap-2 p-2 rounded-lg border cursor-pointer transition ${cfg.rules[k] ? "bg-sky-950/40 border-sky-500/40" : "bg-slate-900 border-slate-800 hover:border-slate-600"}">
      <input type="checkbox" data-rule="${k}" ${cfg.rules[k] ? "checked" : ""} class="mt-0.5 accent-sky-500" />
      <span>
        <span class="font-semibold text-slate-200 block">${rules[k].label}</span>
        <span class="text-[10px] text-slate-500">${rules[k].hint}</span>
      </span>
    </label>`).join("")}</div>`;

  const sampleIdx = aiOptsSampleIdx();
  const sampleDet = currentState.detections[sampleIdx];
  let ctxPreview = "";
  if (sampleDet && (currentState.words || []).length) {
    const w = currentState.words;
    const s = sampleDet.wordStartIdx, e = sampleDet.wordEndIdx;
    const before = w.slice(Math.max(0, s - ctxWords), s).map(x => x.word).join(" ");
    const span = w.slice(s, e + 1).map(x => x.word).join(" ");
    const after = w.slice(e + 1, e + 1 + ctxWords).map(x => x.word).join(" ");
    ctxPreview = `
      <div class="p-2.5 rounded-lg bg-slate-900 border border-slate-800 font-arabic-text text-[13px] leading-loose max-h-32 overflow-y-auto">
        <span class="text-slate-500">${escapeHtml(before)}</span>
        <mark class="bg-amber-500/25 text-amber-200 rounded px-0.5">${escapeHtml(span)}</mark>
        <span class="text-slate-500">${escapeHtml(after)}</span>
      </div>`;
  }
  const ctxHtml = `
    <div class="flex items-center gap-3">
      <input type="range" id="rngAiOptsCtx" min="5" max="60" step="1" value="${ctxWords}" class="flex-1 accent-amber-500" />
      <span id="lblAiOptsCtx" class="font-mono text-amber-300 w-20 text-left">${ctxWords} كلمة</span>
    </div>
    ${ctxPreview}
    <div class="text-[10px] text-slate-500">سياق أطول يساعد على تمييز الاقتباس من الشرح لكنه يرفع التكلفة. 20–30 كلمة مناسبة غالباً.</div>`;

  const reasonHtml = `
    <div class="flex flex-wrap items-center gap-3">
      <div class="flex items-center gap-1">
        <span class="text-slate-400">اللغة:</span>
        ${[["ar", "العربية"], ["en", "English"]].map(([v, l]) => `<button type="button" data-reason-lang="${v}" class="px-2 py-1 rounded-lg border ${cfg.reasonLang === v ? "bg-sky-600/30 text-sky-200 border-sky-500/50" : "bg-slate-900 text-slate-400 border-slate-800"}">${l}</button>`).join("")}
      </div>
      <div class="flex items-center gap-1">
        <span class="text-slate-400">التفصيل:</span>
        ${[["brief", "مختصر"], ["detailed", "مفصّل"]].map(([v, l]) => `<button type="button" data-reason-detail="${v}" class="px-2 py-1 rounded-lg border ${cfg.reasonDetail === v ? "bg-sky-600/30 text-sky-200 border-sky-500/50" : "bg-slate-900 text-slate-400 border-slate-800"}">${l}</button>`).join("")}
      </div>
    </div>
    <div class="text-[10px] text-slate-500">التعليل المفصّل يستهلك توكنز إخراج أكثر، لكنه يوضح الكلمات التي حسمت الحكم.</div>`;

  const extraHtml = `
    <textarea id="txtAiOptsExtra" rows="3" placeholder="اكتب أي توجيه خاص بهذه المحاضرة أو هذا الشيخ... (بالعربية أو الإنجليزية)" class="w-full rounded-lg bg-slate-900 border border-slate-800 px-2.5 py-2 text-slate-200 focus:outline-none focus:border-sky-500 leading-relaxed">${escapeHtml(cfg.extraInstructions)}</textarea>
    <div class="flex flex-wrap items-center gap-1.5">
      <span class="text-[11px] text-slate-400">أمثلة جاهزة (انقر للإضافة):</span>
      ${PROMPT_SNIPPETS.map((sn, i) => `<button type="button" data-snippet="${i}" class="px-2 py-0.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px]" title="${escapeHtml(sn.text)}">＋ ${sn.label}</button>`).join("")}
    </div>`;

  const defaultSys = WahyAiVerifier.DEFAULT_SYSTEM_PROMPTS[prov] || "";
  const sysHtml = supportsSystem ? `
    <details ${cfg.systemPromptOverride ? "open" : ""} class="space-y-2">
      <summary class="cursor-pointer text-slate-300 font-semibold">🛠️ متقدم: تعديل موجّه النظام مباشرة ${cfg.systemPromptOverride ? '<span class="text-amber-400">(معدّل)</span>' : ""}</summary>
      <div class="text-[10px] text-slate-500 pt-1">يحدد «شخصية» النموذج ودوره. اتركه فارغاً لاستخدام الافتراضي. صيغة الإخراج JSON تُضاف تلقائياً فلا داعي لكتابتها.</div>
      <textarea id="txtAiOptsSystem" rows="4" placeholder="${escapeHtml(defaultSys)}" class="w-full rounded-lg bg-slate-900 border border-slate-800 px-2.5 py-2 text-slate-200 focus:outline-none focus:border-sky-500 leading-relaxed">${escapeHtml(cfg.systemPromptOverride)}</textarea>
      <div class="flex gap-1.5">
        <button type="button" id="btnAiOptsSysLoadDefault" class="px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300">📥 تحميل الافتراضي للتعديل</button>
        <button type="button" id="btnAiOptsSysReset" class="px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300">↺ استعادة الافتراضي</button>
      </div>
    </details>` : "";

  body.innerHTML = `
    ${banner}
    <div class="${dim} space-y-4">
      ${section(1, "أسلوب الحكم", "ابدأ من هنا: كيف يتعامل النموذج مع الحالات الحدّية؟", presetsHtml)}
      ${section(2, "قواعد إضافية", "قواعد شائعة لمحاضرات الشرح، فعّل ما يناسب محاضرتك.", rulesHtml)}
    </div>
    ${section(3, "نافذة السياق", `عدد الكلمات التي يراها النموذج قبل وبعد المقتبس${sampleDet ? ` — معاينة على «${escapeHtml(sampleDet.displayRef || "مقتبس")}»` : ""}.`, ctxHtml)}
    <div class="${supportsSystem ? "" : "opacity-50 pointer-events-none"}">
      ${section(4, "التعليل (reason)", "كيف يشرح النموذج سبب حكمه في بطاقة المقتبس.", reasonHtml)}
    </div>
    <div class="${dim}">
      ${section(5, "تعليمات خاصة", "أضف ما تعرفه عن المحاضرة ولا يعرفه النموذج.", extraHtml + sysHtml)}
    </div>
    <div class="space-y-2 p-3 rounded-xl bg-slate-950/60 border border-sky-500/30">
      <div class="flex items-center justify-between">
        <div class="font-bold text-sky-200">👁️ ما سيقرؤه النموذج${sampleDet ? ` <span class="text-[11px] font-normal text-slate-400">(مثال: ${escapeHtml(sampleDet.displayRef || "مقتبس")})</span>` : ""}</div>
        <div class="flex items-center gap-1.5">
          <button type="button" id="btnAiOptsToggleJson" class="px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 font-mono text-[11px]">${aiOptsState.showJson ? "📝 عرض مقروء" : "{ } الطلب الكامل JSON"}</button>
          <button type="button" id="btnAiOptsCopyJson" class="px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px]">📋 نسخ</button>
        </div>
      </div>
      <div id="aiOptsPreview"></div>
    </div>
    <div class="flex justify-start">
      <button type="button" id="btnAiOptsResetPrompt" class="px-2.5 py-1 rounded-lg bg-rose-950/60 hover:bg-rose-900/60 text-rose-300 border border-rose-500/30">↺ إعادة ضبط كل إعدادات الموجّه</button>
    </div>
  `;

  renderAiOptsPreview();

  const rerender = () => { renderAiOptsPromptTab(); refreshAiOptsFooter(); };

  body.querySelectorAll("[data-preset]").forEach(btn => btn.addEventListener("click", () => {
    setAiPromptConfig({ preset: btn.getAttribute("data-preset") });
    rerender();
  }));
  body.querySelectorAll("[data-rule]").forEach(cb => cb.addEventListener("change", () => {
    setAiPromptConfig({ rules: { [cb.getAttribute("data-rule")]: cb.checked } });
    rerender();
  }));
  body.querySelectorAll("[data-reason-lang]").forEach(btn => btn.addEventListener("click", () => {
    setAiPromptConfig({ reasonLang: btn.getAttribute("data-reason-lang") });
    rerender();
  }));
  body.querySelectorAll("[data-reason-detail]").forEach(btn => btn.addEventListener("click", () => {
    setAiPromptConfig({ reasonDetail: btn.getAttribute("data-reason-detail") });
    rerender();
  }));

  const rngCtx = body.querySelector("#rngAiOptsCtx");
  rngCtx?.addEventListener("input", () => {
    const lbl = document.getElementById("lblAiOptsCtx");
    if (lbl) lbl.textContent = `${rngCtx.value} كلمة`;
  });
  rngCtx?.addEventListener("change", () => {
    ai.contextWindowWords = parseInt(rngCtx.value, 10) || 25;
    saveAiConfigToStorage();
    rerender();
  });

  // Text areas update the preview live without re-rendering (keeps focus & caret)
  let typingTimer = null;
  const bindText = (id, key) => {
    const el = body.querySelector(id);
    el?.addEventListener("input", () => {
      clearTimeout(typingTimer);
      typingTimer = setTimeout(() => {
        setAiPromptConfig({ [key]: el.value });
        renderAiOptsPreview();
        refreshAiOptsFooter();
      }, 300);
    });
  };
  bindText("#txtAiOptsExtra", "extraInstructions");
  bindText("#txtAiOptsSystem", "systemPromptOverride");

  body.querySelectorAll("[data-snippet]").forEach(btn => btn.addEventListener("click", () => {
    const sn = PROMPT_SNIPPETS[parseInt(btn.getAttribute("data-snippet"), 10)];
    const cur = (aiOptsCfg().extraInstructions || "").trim();
    if (cur.includes(sn.text)) return;
    setAiPromptConfig({ extraInstructions: cur ? `${cur}\n${sn.text}` : sn.text });
    rerender();
  }));

  body.querySelector("#btnAiOptsSysLoadDefault")?.addEventListener("click", () => {
    setAiPromptConfig({ systemPromptOverride: defaultSys });
    rerender();
  });
  body.querySelector("#btnAiOptsSysReset")?.addEventListener("click", () => {
    setAiPromptConfig({ systemPromptOverride: "" });
    rerender();
  });

  body.querySelector("#btnAiOptsToggleJson")?.addEventListener("click", () => {
    aiOptsState.showJson = !aiOptsState.showJson;
    rerender();
  });
  body.querySelector("#btnAiOptsCopyJson")?.addEventListener("click", async () => {
    const pv = WahyAiVerifier.buildRequestPreview(aiOptsSampleIdx());
    if (!pv) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(pv.payload, null, 2));
      showToast("📋 تم نسخ الطلب الكامل");
    } catch (_) {
      showToast("⚠️ تعذر النسخ إلى الحافظة");
    }
  });
  body.querySelector("#btnAiOptsResetPrompt")?.addEventListener("click", () => {
    if (!confirm("إعادة جميع إعدادات الموجّه إلى الافتراضي؟")) return;
    currentState.aiVerification.promptConfig = null;
    saveAiConfigToStorage();
    rerender();
  });
}

function renderAiOptsPreview() {
  const box = document.getElementById("aiOptsPreview");
  if (!box) return;
  const pv = WahyAiVerifier.buildRequestPreview(aiOptsSampleIdx());
  if (!pv) {
    box.innerHTML = '<div class="text-slate-500">لا يوجد مقتبس للمعاينة.</div>';
    return;
  }
  const meta = `<div class="text-[10px] text-slate-500 font-mono" dir="ltr">${escapeHtml(pv.endpoint)} · ${escapeHtml(pv.model)} · ~${pv.approxTokens} tokens / finding</div>`;

  if (aiOptsState.showJson) {
    box.innerHTML = `${meta}<pre class="mt-1.5 p-2.5 rounded-lg bg-slate-900 border border-slate-800 text-[10px] text-slate-300 font-mono max-h-72 overflow-auto whitespace-pre-wrap" dir="ltr">${escapeHtml(JSON.stringify(pv.payload, null, 2))}</pre>`;
    return;
  }

  // Highlight the parts the user added so it's clear what their settings changed
  const highlightAdded = (txt) => escapeHtml(txt).replace(
    /(Additional guidance:[\s\S]*$)/,
    '<span class="bg-emerald-500/15 text-emerald-200 rounded">$1</span>'
  );
  const v = pv.questions.verdict;
  const b = pv.questions.boundary_status;
  const crit = (c) => Object.keys(c).map(k => `<li><strong class="font-mono text-sky-300">${k}</strong>: ${escapeHtml(c[k])}</li>`).join("");

  box.innerHTML = `
    ${meta}
    <div class="mt-1.5 space-y-2 text-[11px] text-slate-300 leading-relaxed max-h-80 overflow-y-auto p-2.5 rounded-lg bg-slate-900 border border-slate-800" dir="ltr">
      ${pv.systemPrompt ? `<div><div class="text-[10px] uppercase text-slate-500 font-bold">System</div><div class="whitespace-pre-wrap">${escapeHtml(pv.systemPrompt)}</div></div>` : ""}
      <div><div class="text-[10px] uppercase text-slate-500 font-bold">Verdict question</div><div class="whitespace-pre-wrap">${highlightAdded(v.instructions)}</div><ul class="list-disc pl-4 mt-1 space-y-0.5">${crit(v.criteria)}</ul></div>
      <div><div class="text-[10px] uppercase text-slate-500 font-bold">Boundary question</div><div class="whitespace-pre-wrap">${escapeHtml(b.instructions)}</div></div>
      <div class="text-[10px] text-slate-500">+ بيانات المقتبس (السياق، النص المرجعي، درجة المحرك...) — اعرض JSON لرؤيتها كاملة.</div>
    </div>`;
}

// -----------------------------------------------------------------------------
// Wiring
// -----------------------------------------------------------------------------

window.addEventListener("DOMContentLoaded", () => {
  document.getElementById("btnOpenAiRequestOptions")?.addEventListener("click", () => openAiRequestOptions({ mode: "batch" }));
  document.getElementById("btnCloseAiRequestOptions")?.addEventListener("click", closeAiRequestOptions);
  document.getElementById("btnAiOptsDone")?.addEventListener("click", closeAiRequestOptions);

  document.getElementById("modalAiRequestOptions")?.addEventListener("click", (e) => {
    if (e.target.id === "modalAiRequestOptions") closeAiRequestOptions();
  });
  document.addEventListener("keydown", (e) => {
    const modal = document.getElementById("modalAiRequestOptions");
    if (e.key === "Escape" && modal && !modal.classList.contains("hidden")) closeAiRequestOptions();
  });

  document.getElementById("btnAiOptsLaunch")?.addEventListener("click", () => {
    const single = aiOptsState.mode === "single";
    const idx = aiOptsState.findingIdx;
    closeAiRequestOptions();
    if (typeof window.triggerAiVerification !== "function") return;
    window.triggerAiVerification(single ? [idx] : null);
  });

  updateAiLaunchButtonLabel();
});
