import type { MessageKey } from "./ar";
import type { Lang } from "./index";

/** The product's own words (docs/editions.md): its name, and plain wording where the studio talks about
 *  training data. Any key not listed here reads as in the studio. */
export const tadqeeq: Record<Lang, Partial<Record<MessageKey, string>>> = {
  ar: {
    "app.name": "تدقيق",
    "lectures.source.sampleHint": "جرّب التطبيق في ثوانٍ",
    "lectures.sampleText": "محاضرة قصيرة فيها آيات وأحاديث وأذكار. جرّبها لترى كيف تُكتشف الاقتباسات.",
    "verify.approveConfirm": "اضغط للتأكيد: تُعتمد كل الأحكام كأنها منك",
    "verify.approved": "اعتُمد {n} حكما",
    "insp.gold": "(حكمك)",
    "insp.goldSaved": "حُفظ حكمك",
    "delete.help": "اذكر السبب حتى لا يُكتشف الاقتباس خطأً مرة أخرى.",
    "delete.ordinary_speech.help": "ليس اقتباسا: كلام الشيخ نفسه.",
    "delete.done.ordinary_speech": "حُذف الاقتباس وعُلّم «كلاما عاديا»",
  },
  en: {
    "app.name": "Tadqeeq",
    "lectures.source.sampleHint": "Try the app in seconds",
    "lectures.sampleText": "A short lecture with verses, hadith and adhkar. Try it to see how quotes are found.",
    "verify.approveConfirm": "Click to confirm: marks every verdict as checked by you",
    "verify.approved": "{n} verdicts approved",
    "insp.gold": "(yours)",
    "insp.goldSaved": "Your verdict is saved",
    "delete.help": "Say why, so the quote is not found again by mistake.",
    "delete.ordinary_speech.help": "Not a quote: the speaker's own words.",
    "delete.done.ordinary_speech": "Quote deleted and marked as ordinary speech",
  },
};
