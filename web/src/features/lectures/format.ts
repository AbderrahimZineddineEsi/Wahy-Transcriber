/** The server sends UTC times without a zone suffix; make sure the browser reads them as UTC. */
export function parseServerDate(value: string): Date {
  return new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(value) ? value : `${value}Z`);
}

export function formatDate(value: string, lang: string): string {
  return new Intl.DateTimeFormat(lang === "ar" ? "ar-u-nu-latn" : "en", { dateStyle: "medium", timeStyle: "short" }).format(
    parseServerDate(value),
  );
}
