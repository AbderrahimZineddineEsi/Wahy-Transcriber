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

# batch 2 (for engine v5's loose profile): mostly hadith/text commentaries + some khutbas, 10-35 min, no batch-1 video reused
YOUTUBE_2 = {
    "ibn_uthaymeen": ["btxBgUti_sw", "XCSRci8tbzY", "8McftTgK3bU"],  # رياض الصالحين باب الإخلاص (إنما الأعمال بالنيات) · بلوغ المرام يا معشر الشباب · تفسير سورة الماعون (لقاء 114)
    "al_fawzan": ["iHxNHbd6V-U", "gFCif1bK1_U", "HYaYmnLkfb8"],      # الأربعين النووية 1 إنما الأعمال بالنيات · الأربعين النووية 24 · كتاب التوحيد باب من حقق التوحيد
    "aziz_farhan_al_anzi": ["XDuO4xlkDME", "DRFjD0nNlR4", "HgYC6n5vVvk"],  # محاضرة إنما يتقبل الله من المتقين · خطبة الجمعة (الشارقة) · خطبة أسباب جلب البركة
    "al_albani": ["dwro60OCmD0", "VteI_AeKtGI", "0NpOzXjhhHw"],      # شرح حديث إنما الأعمال بالنيات · سلسلة الهدى والنور 585 · سلسلة الترغيب والترهيب الشريط 1
    "saleh_al_sheikh": ["EDjJazSZyIg", "jveACbsENQk", "BANg4nARo6Y"],  # الأربعين النووية: احفظ الله يحفظك · لو يعطى الناس بدعواهم · إذا لم تستح فاصنع ما شئت
    "abdulrazzaq_al_badr": ["io_FZNECNXg", "DVrsvCIkNmE", "BUcmdQ6gFTM"],  # شرح حديث عجب ربنا من قنوط عباده · تفسير سورة الناس · شرح حديث الجساسة
    "sulayman_al_ruhayli": ["eXzOmLDzkVg", "NfYV__0yCy4", "e4QL-8pnxew"],  # شرح حديث الدنيا ملعونة · شرح حديث وأما المهلكات · شرح حديث الجساسة
    "saleh_al_osaimi": ["f_BPvUi6P80", "XeZ9Avwa0Ok", "WdOJ7pUgkgg"],  # تقريب شرح الأربعين النووية: المقدمة · الحديث 9 ما نهيتكم عنه فاجتنبوه · شرح الأربعين النووية 1 (الراية)
    "abdussalam_al_shuwayer": ["Bzcd4Z2frtM", "LLxBHNVeH6g", "OQ2lLRtlmwI"],  # شرح التجريد لأحاديث العمدة 20 · التجريد 19 · خطبة مواسم الخير
    "mohammed_meziane": ["DXR7qH70ySM", "NuRgFU6tb_0", "opRsS3zqJog"],  # خمس إذا ابتليتم بهن · صحيح الترغيب والترهيب كتاب التوبة والزهد 1 · خطبة شر الخلق والخليقة
    "saleh_sindi": ["qdXZhJqHpFM", "fy8LmPgLEbQ", "LgL0_vTfuZg", "KrKsrNbmQqI"],  # مسائل في حديث الصورة · مجالس العقيدة الخوف من الله · خطبة تعظيم الدليل · خطبة حديث عن القلوب
    "saeed_ruslan": ["ntevs6C31-M", "W92_eLFiE1A", "1nu7B4RmgjE", "-R4qfVB8cMw"],  # الأربعين النووية 31 ازهد في الدنيا · الأربعين النووية 10 إن الله طيب · عمدة الأحكام الحديث الأول · تفسير سورة الإنسان
}

# batch 2 Bin Baz: radio talks (series 20) + a phone lecture (series 56), all with a written transcript; 185 skipped (broken mp3 link)
BINBAZ_2 = [
    "https://binbaz.org.sa/audios/187/%D8%A7%D9%84%D8%B5%D9%84%D8%A7%D8%A9-%D9%81%D9%8A-%D8%A7%D9%84%D8%A7%D8%B3%D9%84%D8%A7%D9%85",  # radio · الصلاة في الإسلام
    "https://binbaz.org.sa/audios/188/%D8%A7%D9%84%D8%B7%D9%84%D8%A7%D9%82-%D8%A7%D9%84%D8%A8%D8%AF%D8%B9%D9%8A-%D9%88%D8%A7%D9%84%D8%B7%D9%84%D8%A7%D9%82-%D8%A7%D9%84%D8%B3%D9%86%D9%8A",  # radio · الطلاق البدعي والطلاق السني
    "https://binbaz.org.sa/audios/189/%D8%A7%D9%84%D8%B7%D9%84%D8%A7%D9%82-%D8%A7%D9%84%D8%B4%D8%B1%D8%B9%D9%8A",  # radio · الطلاق الشرعي
    "https://binbaz.org.sa/audios/190/%D8%A7%D9%84%D8%B7%D9%85%D8%A7%D9%86%D9%8A%D9%86%D8%A9-%D9%81%D9%8A-%D8%A7%D9%84%D8%B5%D9%84%D8%A7%D8%A9",  # radio · الطمأنينة في الصلاة
    "https://binbaz.org.sa/audios/191/%D8%A7%D9%84%D8%B9%D9%86%D8%A7%D9%8A%D8%A9-%D8%A8%D8%B7%D9%87%D8%A7%D8%B1%D8%A9-%D8%A7%D9%84%D9%82%D9%84%D8%A8",  # radio · العناية بطهارة القلب
    "https://binbaz.org.sa/audios/192/%D8%A7%D9%84%D9%85%D8%B1%D8%A7%D8%A9-%D9%88%D8%A7%D9%84%D8%B3%D9%81%D9%88%D8%B1",  # radio · المرأة والسفور
    "https://binbaz.org.sa/audios/193/%D9%88%D8%AC%D9%88%D8%A8-%D8%A7%D9%84%D8%A7%D8%B3%D8%AA%D9%82%D8%A7%D9%85%D8%A9",  # radio · وجوب الاستقامة
    "https://binbaz.org.sa/audios/1821/%D8%A7%D8%AD%D9%83%D8%A7%D9%85-%D8%A7%D9%84%D8%AD%D8%AC",  # phone · أحكام الحج
]
