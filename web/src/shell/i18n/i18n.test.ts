import { expect, test } from "vitest";
import { ar } from "./ar";
import { en } from "./en";
import { translate } from "./index";

test("English has exactly the keys Arabic has", () => {
  expect(Object.keys(en).sort()).toEqual(Object.keys(ar).sort());
});

test("no text is empty in either language", () => {
  for (const dictionary of [ar, en]) for (const text of Object.values(dictionary)) expect(text.trim()).not.toBe("");
});

test("both languages have the same {slots} in each text", () => {
  const slots = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
  for (const key of Object.keys(ar) as (keyof typeof ar)[]) expect(slots(en[key])).toEqual(slots(ar[key]));
});

test("translate fills the slots and leaves unknown ones visible", () => {
  expect(translate("en", "settings.keySaved", { provider: "Groq" })).toBe("Groq key saved");
  expect(translate("ar", "settings.keySaved", { provider: "Groq" })).toBe("تم حفظ مفتاح Groq");
  expect(translate("en", "settings.keySaved")).toBe("{provider} key saved");
});

test("the product's own words cover both languages, keep the same {slots} and win over the studio's", async () => {
  const { tadqeeq } = await import("./tadqeeq");
  expect(Object.keys(tadqeeq.en).sort()).toEqual(Object.keys(tadqeeq.ar).sort());
  const slots = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
  for (const [key, text] of Object.entries(tadqeeq.ar)) expect(slots(text!)).toEqual(slots(ar[key as keyof typeof ar]));
  expect(translate("en", "insp.gold", undefined, "tadqeeq")).toBe("(yours)");
  expect(translate("en", "insp.gold")).toBe("(gold)");
  expect(translate("en", "settings.keySaved", { provider: "Groq" }, "tadqeeq")).toBe("Groq key saved"); // not overridden
});
