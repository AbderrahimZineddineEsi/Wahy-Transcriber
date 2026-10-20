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

// Core 42 Prophetic Adhkar & Duas (from Wahy-Finder) so Adhkar Studio works immediately & can reset to defaults
const BUILTIN_ADHKAR_DATA = [
  { id: "Adhkar:1", category: "الاستغفار والتوبة", ref: "سيد الاستغفار (صحيح البخاري 6306)", t: "اللَّهُمَّ أَنْتَ رَبِّي لَا إِلَٰهَ إِلَّا أَنْتَ خَلَقْتَنِي وَأَنَا عَبْدُكَ وَأَنَا عَلَىٰ عَهْدِكَ وَوَعْدِكَ مَا اسْتَطَعْتُ أَعُوذُ بِكَ مِنْ شَرِّ مَا صَنَعْتُ أَبُوءُ لَكَ بِنِعْمَتِكَ عَلَيَّ وَأَبُوءُ لَكَ بِذَنْبِي فَاغْفِرْ لِي فَإِنَّهُ لَا يَغْفِرُ الذُّنُوبَ إِلَّا أَنْتَ" },
  { id: "Adhkar:2", category: "الاستغفار والتوبة", ref: "استغفار التوبة (سنن أبي داود 1517)", t: "أَسْتَغْفِرُ اللَّهَ الَّذِي لَا إِلَٰهَ إِلَّا هُوَ الْحَيُّ الْقَيُّومُ وَأَتُوبُ إِلَيْهِ" },
  { id: "Adhkar:3", category: "الاستغفار والتوبة", ref: "استغفار الكفارة (صحيح مسلم 2702)", t: "أَسْتَغْفِرُ اللَّهَ الْعَظِيمَ الَّذِي لَا إِلَٰهَ إِلَّا هُوَ الْحَيَّ الْقَيُّومَ وَأَتُوبُ إِلَيْهِ" },
  { id: "Adhkar:4", category: "كفارة المجلس", ref: "كفارة المجلس (سنن أبي داود 4859)", t: "سُبْحَانَكَ اللَّهُمَّ وَبِحَمْدِكَ أَشْهَدُ أَنْ لَا إِلَٰهَ إِلَّا أَنْتَ أَسْتَغْفِرُكَ وَأَتُوبُ إِلَيْهِ" },
  { id: "Adhkar:5", category: "كفارة المجلس", ref: "كفارة المجلس (رواية النسائي 1344)", t: "سُبْحَانَكَ اللَّهُمَّ وَبِحَمْدِكَ أَشْهَدُ أَنْ لَا إِلَٰهَ إِلَّا أَنْتَ أَسْتَغْفِرُكَ وَأَتُوبُ إِلَيْكَ" },
  { id: "Adhkar:6", category: "التهليل والتسبيح", ref: "التهليل الجامع (صحيح البخاري 3293)", t: "لَا إِلَٰهَ إِلَّا اللَّهُ وَحْدَهُ لَا شَرِيكَ لَهُ لَهُ الْمُلْكُ وَلَهُ الْحَمْدُ وَهُوَ عَلَىٰ كُلِّ شَيْءٍ قَدِيرٌ" },
  { id: "Adhkar:7", category: "أذكار الصباح والمساء", ref: "تهليل الصباح والمساء (سنن أبي داود 5069)", t: "لَا إِلَٰهَ إِلَّا اللَّهُ وَحْدَهُ لَا شَرِيكَ لَهُ لَهُ الْمُلْكُ وَلَهُ الْحَمْدُ يُحْيِي وَيُمِيتُ وَهُوَ عَلَىٰ كُلِّ شَيْءٍ قَدِيرٌ" },
  { id: "Adhkar:8", category: "التهليل والتسبيح", ref: "الباقيات الصالحات (صحيح مسلم 2137)", t: "سُبْحَانَ اللَّهِ وَالْحَمْدُ لِلَّهِ وَلَا إِلَٰهَ إِلَّا اللَّهُ وَاللَّهُ أَكْبَرُ وَلَا حَوْلَ وَلَا قُوَّةَ إِلَّا بِاللَّهِ الْعَلِيِّ الْعَظِيمِ" },
  { id: "Adhkar:9", category: "أذكار الصباح والمساء", ref: "التسبيح المضاعف (صحيح مسلم 2726)", t: "سُبْحَانَ اللَّهِ وَبِحَمْدِهِ عَدَدَ خَلْقِهِ وَرِضَا نَفْسِهِ وَزِنَةَ عَرْشِهِ وَمِدَادَ كَلِمَاتِهِ" },
  { id: "Adhkar:10", category: "التهليل والتسبيح", ref: "كلمتان حبيبتان إلى الرحمن (صحيح البخاري 6406)", t: "سُبْحَانَ اللَّهِ وَبِحَمْدِهِ سُبْحَانَ اللَّهِ الْعَظِيمِ" },
  { id: "Adhkar:11", category: "أذكار الصلاة", ref: "أذكار بعد السلام من الصلاة (صحيح مسلم 593)", t: "اللَّهُمَّ أَنْتَ السَّلَامُ وَمِنْكَ السَّلَامُ تَبَارَكْتَ يَا ذَا الْجَلَالِ وَالْإِكْرَامِ" },
  { id: "Adhkar:12", category: "أذكار الصلاة", ref: "الذكر عقب الوتر (سنن النسائي 1732)", t: "سُبْحَانَ الْمَلِكِ الْقُدُّوسِ رَبِّ الْمَلَائِكَةِ وَالرُّوحِ" },
  { id: "Adhkar:13", category: "أذكار الصلاة", ref: "دعاء الإعانة على الذكر والشكر (سنن أبي داود 1522)", t: "اللَّهُمَّ أَعِنِّي عَلَىٰ ذِكْرِكَ وَشُكْرِكَ وَحُسْنِ عِبَادَتِكَ" },
  { id: "Adhkar:14", category: "أدعية الكرب والهم", ref: "دعاء الكرب العظيم (صحيح البخاري 6346)", t: "لَا إِلَٰهَ إِلَّا اللَّهُ الْعَظِيمُ الْحَلِيمُ لَا إِلَٰهَ إِلَّا اللَّهُ رَبُّ الْعَرْشِ الْعَظِيمِ لَا إِلَٰهَ إِلَّا اللَّهُ رَبُّ السَّمَاوَاتِ وَرَبُّ الْأَرْضِ وَرَبُّ الْعَرْشِ الْكَرِيمِ" },
  { id: "Adhkar:15", category: "أدعية الكرب والهم", ref: "دعاء تفريج الكرب (سنن أبي داود 5090)", t: "اللَّهُمَّ رَحْمَتَكَ أَرْجُو فَلَا تَكِلْنِي إِلَىٰ نَفْسِي طَرْفَةَ عَيْنٍ وَأَصْلِحْ لِي شَأْنِي كُلَّهُ لَا إِلَٰهَ إِلَّا أَنْتَ" },
  { id: "Adhkar:16", category: "أدعية الكرب والهم", ref: "الاستغاثة برحمة الله (الترمذي 3524)", t: "يَا حَيُّ يَا قَيُّومُ بِرَحْمَتِكَ أَسْتَغِيثُ أَصْلِحْ لِي شَأْنِي كُلَّهُ وَلَا تَكِلْنِي إِلَىٰ نَفْسِي طَرْفَةَ عَيْنٍ" },
  { id: "Adhkar:17", category: "أذكار الصباح والمساء", ref: "التعوذ بكلمات الله التامات (صحيح مسلم 2708)", t: "أَعُوذُ بِكَلِمَاتِ اللَّهِ التَّامَّاتِ مِنْ شَرِّ مَا خَلَقَ" },
  { id: "Adhkar:18", category: "أذكار الصباح والمساء", ref: "ذكر الحفظ صباحاً ومساءً (سنن أبي داود 5088)", t: "بِسْمِ اللَّهِ الَّذِي لَا يَضُرُّ مَعَ اسْمِهِ شَيْءٌ فِي الْأَرْضِ وَلَا فِي السَّمَاءِ وَهُوَ السَّمِيعُ الْعَلِيمُ" },
  { id: "Adhkar:19", category: "أذكار الصباح والمساء", ref: "الرضا بالله رباً وبالإسلام ديناً (سنن أبي داود 5072)", t: "رَضِيتُ بِاللَّهِ رَبًّا وَبِالْإِسْلَامِ دِينًا وَبِمُحَمَّدٍ صَلَّى اللَّهُ عَلَيْهِ وَسَلَّمَ نَبِيًّا وَرَسُولًا" },
  { id: "Adhkar:20", category: "أدعية جامعة", ref: "سؤال العفو والعافية (سنن ابن ماجه 3871)", t: "اللَّهُمَّ إِنِّي أَسْأَلُكَ الْعَفْوَ وَالْعَافِيَةَ فِي الدُّنْيَا وَالْآخِرَةِ اللَّهُمَّ إِنِّي أَسْأَلُكَ الْعَفْوَ وَالْعَافِيَةَ فِي دِينِي وَدُنْيَايَ وَأَهْلِي وَمَالِي" },
  { id: "Adhkar:21", category: "أدعية جامعة", ref: "دعاء ليلة القدر (جامع الترمذي 3513)", t: "اللَّهُمَّ إِنَّكَ عَفُوٌّ تُحِبُّ الْعَفْوَ فَاعْفُ عَنِّي" },
  { id: "Adhkar:22", category: "أدعية جامعة", ref: "سؤال الهدى والتقى والعفاف والغنى (صحيح مسلم 2721)", t: "اللَّهُمَّ إِنِّي أَسْأَلُكَ الْهُدَىٰ وَالتُّقَىٰ وَالْعَفَافَ وَالْغِنَىٰ" },
  { id: "Adhkar:23", category: "أدعية جامعة", ref: "دعاء تثبيت القلوب (جامع الترمذي 2140)", t: "يَا مُقَلِّبَ الْقُلُوبِ ثَبِّتْ قَلْبِي عَلَىٰ دِينِكَ" },
  { id: "Adhkar:24", category: "أدعية جامعة", ref: "دعاء تصريف القلوب على الطاعة (صحيح مسلم 2654)", t: "اللَّهُمَّ مُصَرِّفَ الْقُلُوبِ صَرِّفْ قُلُوبَنَا عَلَىٰ طَاعَتِكَ" },
  { id: "Adhkar:25", category: "أدعية الكرب والهم", ref: "الاستعاذة من العجز والكسل والهم (صحيح البخاري 6369)", t: "اللَّهُمَّ إِنِّي أَعُوذُ بِكَ مِنَ الْهَمِّ وَالْحَزَنِ وَالْعَجْزِ وَالْكَسَلِ وَالْبُخْلِ وَالْجُبْنِ وَضَلَعِ الدَّيْنِ وَغَلَبَةِ الرِّجَالِ" },
  { id: "Adhkar:26", category: "أدعية جامعة", ref: "الاستعاذة من علم لا ينفع (صحيح مسلم 2722)", t: "اللَّهُمَّ إِنِّي أَعُوذُ بِكَ مِنْ عِلْمٍ لَا يَنْفَعُ وَمِنْ قَلْبٍ لَا يَخْشَعُ وَمِنْ نَفْسٍ لَا تَشْبَعُ وَمِنْ دَعْوَةٍ لَا يُسْتَجَابُ لَهَا" },
  { id: "Adhkar:27", category: "أذكار الصباح والمساء", ref: "سؤال العلم النافع والرزق الطيب (سنن ابن ماجه 925)", t: "اللَّهُمَّ إِنِّي أَسْأَلُكَ عِلْمًا نَافِعًا وَرِزْقًا طَيِّبًا وَعَمَلًا مُتَقَبَّلًا" },
  { id: "Adhkar:28", category: "أدعية جامعة", ref: "الاستعاذة من زوال النعمة (صحيح مسلم 2739)", t: "اللَّهُمَّ إِنِّي أَعُوذُ بِكَ مِنْ زَوَالِ نِعْمَتِكَ وَتَحَوُّلِ عَافِيَتِكَ وَفُجَاءَةِ نِقْمَتِكَ وَجَمِيعِ سَخَطِكَ" },
  { id: "Adhkar:29", category: "أذكار الصباح والمساء", ref: "دعاء الصباح والمساء (صحيح مسلم 2723)", t: "أَصْبَحْنَا وَأَصْبَحَ الْمُلْكُ لِلَّهِ وَالْحَمْدُ لِلَّهِ لَا إِلَٰهَ إِلَّا اللَّهُ وَحْدَهُ لَا شَرِيكَ لَهُ" },
  { id: "Adhkar:30", category: "أذكار الصباح والمساء", ref: "دعاء الفطرة في الصباح (مسند أحمد 15360)", t: "أَصْبَحْنَا عَلَىٰ فِطْرَةِ الْإِسْلَامِ وَعَلَىٰ كَلِمَةِ الْإِخْلَاصِ وَعَلَىٰ دِينِ نَبِيِّنَا مُحَمَّدٍ صَلَّى اللَّهُ عَلَيْهِ وَسَلَّمَ وَعَلَىٰ مِلَّةِ أَبِينَا إِبْرَاهِيمَ حَنِيفًا مُسْلِمًا وَمَا كَانَ مِنَ الْمُشْرِكِينَ" },
  { id: "Adhkar:31", category: "أذكار الصلاة", ref: "دعاء الاستفتاح (سنن أبي داود 775)", t: "سُبْحَانَكَ اللَّهُمَّ وَبِحَمْدِكَ وَتَبَارَكَ اسْمُكَ وَتَعَالَىٰ جَدُّكَ وَلَا إِلَٰهَ غَيْرُكَ" },
  { id: "Adhkar:32", category: "أذكار الصلاة", ref: "الاستعاذة قبل السلام (صحيح مسلم 588)", t: "اللَّهُمَّ إِنِّي أَعُوذُ بِكَ مِنْ عَذَابِ جَهَنَّمَ وَمِنْ عَذَابِ الْقَبْرِ وَمِنْ فِتْنَةِ الْمَحْيَا وَالْمَمَاتِ وَمِنْ شَرِّ فِتْنَةِ الْمَسِيحِ الدَّجَّالِ" },
  { id: "Adhkar:33", category: "أذكار الصلاة", ref: "الصلاة الإبراهيمية (صحيح البخاري 3370)", t: "اللَّهُمَّ صَلِّ عَلَىٰ مُحَمَّدٍ وَعَلَىٰ آلِ مُحَمَّدٍ كَمَا صَلَّيْتَ عَلَىٰ إِبْرَاهِيمَ وَعَلَىٰ آلِ إِبْرَاهِيمَ إِنَّكَ حَمِيدٌ مَجِيدٌ" },
  { id: "Adhkar:34", category: "أذكار الصلاة", ref: "التشهد في الصلاة (صحيح البخاري 831)", t: "التَّحِيَّاتُ لِلَّهِ وَالصَّلَوَاتُ وَالطَّيِّبَاتُ السَّلَامُ عَلَيْكَ أَيُّهَا النَّبِيُّ وَرَحْمَةُ اللَّهِ وَبَرَكَاتُهُ السَّلَامُ عَلَيْنَا وَعَلَىٰ عِبَادِ اللَّهِ الصَّالِحِينَ" },
  { id: "Adhkar:35", category: "أذكار الصلاة", ref: "دعاء القنوت (سنن أبي داود 1425)", t: "اللَّهُمَّ اهْدِنِي فِيمَنْ هَدَيْتَ وَعَافِنِي فِيمَنْ عَافَيْتَ وَتَوَلَّنِي فِيمَنْ تَوَلَّيْتَ وَبَارِكْ لِي فِيمَا أَعْطَيْتَ وَقِنِي شَرَّ مَا قَضَيْتَ" },
  { id: "Adhkar:36", category: "أذكار الصلاة", ref: "الذكر بعد الصلاة (صحيح البخاري 844)", t: "لَا إِلَٰهَ إِلَّا اللَّهُ وَحْدَهُ لَا شَرِيكَ لَهُ لَهُ الْمُلْكُ وَلَهُ الْحَمْدُ وَهُوَ عَلَىٰ كُلِّ شَيْءٍ قَدِيرٌ اللَّهُمَّ لَا مَانِعَ لِمَا أَعْطَيْتَ وَلَا مُعْطِيَ لِمَا مَنَعْتَ وَلَا يَنْفَعُ ذَا الْجَدِّ مِنْكَ الْجَدُّ" },
  { id: "Adhkar:37", category: "أدعية جامعة", ref: "سؤال الجنة والاستعاذة من النار (سنن أبي داود 792)", t: "اللَّهُمَّ إِنِّي أَسْأَلُكَ الْجَنَّةَ وَأَعُوذُ بِكَ مِنَ النَّارِ" },
  { id: "Adhkar:38", category: "أدعية جامعة", ref: "سؤال الجنة وما قرب إليها (سنن ابن ماجه 3846)", t: "اللَّهُمَّ إِنِّي أَسْأَلُكَ الْجَنَّةَ وَمَا قَرَّبَ إِلَيْهَا مِنْ قَوْلٍ أَوْ عَمَلٍ وَأَعُوذُ بِكَ مِنَ النَّارِ وَمَا قَرَّبَ إِلَيْهَا مِنْ قَوْلٍ أَوْ عَمَلٍ" },
  { id: "Adhkar:39", category: "الاستغفار والتوبة", ref: "التوبة والاستغفار المأثور (صحيح البخاري 6307)", t: "رَبِّ اغْفِرْ لِي وَتُبْ عَلَيَّ إِنَّكَ أَنْتَ التَّوَّابُ الرَّحِيمُ" },
  { id: "Adhkar:40", category: "أدعية جامعة", ref: "دعاء الاستخارة (صحيح البخاري 1166)", t: "اللَّهُمَّ إِنِّي أَسْتَخِيرُكَ بِعِلْمِكَ وَأَسْتَقْدِرُكَ بِقُدْرَتِكَ وَأَسْأَلُكَ مِنْ فَضْلِكَ الْعَظِيمِ" },
  { id: "Adhkar:41", category: "أذكار اليوم والليلة", ref: "دعاء الخروج من المنزل (سنن أبي داود 5095)", t: "بِسْمِ اللَّهِ تَوَكَّلْتُ عَلَى اللَّهِ وَلَا حَوْلَ وَلَا قُوَّةَ إِلَّا بِاللَّهِ" },
  { id: "Adhkar:42", category: "أذكار الحج والعمرة", ref: "تلبية الحج والعمرة (صحيح البخاري 1549)", t: "لَبَّيْكَ اللَّهُمَّ لَبَّيْكَ لَبَّيْكَ لَا شَرِيكَ لَكَ لَبَّيْكَ إِنَّ الْحَمْدَ وَالنِّعْمَةَ لَكَ وَالْمُلْكَ لَا شَرِيكَ لَكَ" }
];

let RAW_QURAN_DATA = [];
let RAW_HADITH_DATA = [];
let RAW_ADHKAR_DATA = BUILTIN_ADHKAR_DATA.map(x => ({ ...x }));
let RAW_OUTSIDE_HADITH_DATA = [];
const PRESET_LECTURES = {};

const LS_CUSTOM_ADHKAR_KEY = "wahyTranscriber_adhkarDataset_v21";
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
      visibilityFilter: currentState.aiVerification.visibilityFilter
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
  const newQSegs = [];
  const newCanonSegs = [];
  for (let idx = 0; idx < det.segments.length; idx++) {
    const [s, e] = det.segments[idx];
    const prevHintQS = (det.qSegments && det.qSegments[idx]) ? det.qSegments[idx][0] : null;
    const [bestQS, bestQE] = alignTranscriptSegToUnit(tNorms, s, e, unit, prevHintQS);
    newQSegs.push([bestQS, bestQE]);
    newCanonSegs.push(unit.vocalizedWords.slice(bestQS, bestQE).join(" "));
  }
  det.qSegments = newQSegs;
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

  activeMatcher = new QuotationMatcherJS(
    RAW_QURAN_DATA,
    RAW_HADITH_DATA,
    params,
    activeAdhkar,
    activeOutside
  );

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
    const req = window.indexedDB.open(IDB_LECTURES_DB_NAME, 1);
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
