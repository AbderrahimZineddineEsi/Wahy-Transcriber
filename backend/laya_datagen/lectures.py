"""The lecture set for automatic labelling: YouTube lectures by sheikh + new Bin Baz lessons (not used in the review)."""

# sheikh -> YouTube video ids (8-33 min, official channels / real lessons preferred over edited clips with music)
YOUTUBE = {
    "ibn_uthaymeen": ["M-d6CIyy8ds", "xiXs8sApQG0"],      # شرح آية الكرسي (لقاء 67) · شرح رياض الصالحين باب الاستغفار
    "al_fawzan": ["NjbOTLyZmOQ", "3uTbMxOFxbQ"],          # شرح القواعد الأربع · فتنة لا تسمع ولا تنطق
    "aziz_farhan_al_anzi": ["XIpPzcA7B1g", "61rTXF9hYiE"],  # وأفوض أمري إلى الله · علاج القلق والاكتئاب
    "al_albani": ["MNr1gGJhaZo", "NEiBPsEgP_s"],          # معنى لا إله إلا الله ونواقضها · موعظة في تقوى الله
    "saleh_al_sheikh": ["OPfH3AllCM4", "kNp2-lvpeNA"],    # مقصد سورة العنكبوت · شرح كتاب التوحيد باب المصورين
    "abdulrazzaq_al_badr": ["ExkaemlknP4", "VNEh4-Sjg3U"],  # العمل في عشر ذي الحجة · مجاهدة النفس والاستقامة
    "sulayman_al_ruhayli": ["tE3j86tyEQc", "cZuDXv2Wnag"],  # خطبة أفلا يتدبرون القرآن · خطبة عن الموت
    "saleh_al_osaimi": ["pckn5mI4Q5g", "iG2F8nymm1A"],    # خطبة نداء الله للإنسان · خطبة جناحا الاستقامة
    "abdussalam_al_shuwayer": ["ZtQpdJXf8GY", "u3hNd4jL0yQ"],  # شرح شروط الصلاة وأركانها · خطبة القلب السليم
    "mohammed_meziane": ["PHYr4tT9--Q", "sY5LW-A2014"],   # تعظيم الله · ثم لتسألن يومئذ عن النعيم
}

# new Bin Baz lessons (short talks with a written transcript = ground truth), none of them used in the review
BINBAZ = [
    "https://binbaz.org.sa/audios/183/%D8%A7%D9%84%D8%AD%D8%AC-%D9%88%D8%A7%D9%84%D8%B9%D9%85%D8%B1%D8%A9",  # radio · الحج والعمرة
    "https://binbaz.org.sa/audios/184/%D8%A7%D9%84%D8%AD%D8%AC",  # radio · الحج
    "https://binbaz.org.sa/audios/186/%D8%A7%D9%84%D8%AE%D8%B5%D8%A7%D9%84-%D8%A7%D9%84%D8%AD%D9%85%D9%8A%D8%AF%D8%A9",  # radio · الخصال الحميدة (185's mp3 link is broken)
    "https://binbaz.org.sa/audios/1823/%D9%81%D9%88%D8%A7%D9%89%D8%AF-%D8%A7%D9%84%D8%B0%D9%83%D8%B1",  # phone · فوائد الذكر
    "https://binbaz.org.sa/audios/1824/%D9%86%D8%B5%D9%8A%D8%AD%D8%A9",  # phone · نصيحة
]

# every Bin Baz lesson processed for the review notebook (laya_review.ipynb): never reused here
REVIEWED = {
    "binbaz_audio_180", "binbaz_audio_181", "binbaz_audio_182", "binbaz_audio_1822", "binbaz_audio_1937",
    "binbaz_audio_1939", "binbaz_audio_2086", "binbaz_audio_2950", "binbaz_audio_561", "binbaz_audio_565",
    "binbaz_audio_567", "binbaz_audio_571", "binbaz_audio_791", "binbaz_audio_820", "binbaz_audio_821",
    "binbaz_audio_961",
}
