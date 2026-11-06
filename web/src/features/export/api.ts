// The export style (F-071) and the export files (F-069, F-070). The files are written by the server (the engine's
// export.ts), so what is downloaded is exactly what the server's tests compare with the golden files.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, data } from "../../api/client";
import type { components } from "../../api/schema";
import type { Kind } from "../lectures/view/model";

export type ExportStyle = Required<components["schemas"]["ExportStyle"]>;
export type ExportStylePatch = components["schemas"]["ExportStylePatch"];
export type ExportFormat = "srt" | "vtt" | "ass" | "md" | "txt" | "json" | "html";
export type VerdictShown = "CORRECT" | "NOT_SURE" | "FALSE" | "NONE";

/** What the server uses until the style is read (the same defaults). */
export const DEFAULT_STYLE: ExportStyle = {
  quranBracketOpen: "﴿",
  quranBracketClose: "﴾",
  hadithBracketOpen: "«",
  hadithBracketClose: "»",
  adhkarBracketOpen: "〖",
  adhkarBracketClose: "〗",
  groupContiguousAyat: true,
  showQuranSource: true,
  showHadithSource: true,
  showAdhkarTag: true,
  splitCommentary: true,
};

export function useExportStyle() {
  return useQuery({
    queryKey: ["export-style"],
    meta: { silent: true },
    queryFn: async () => ({ ...DEFAULT_STYLE, ...(await data(api.GET("/api/export/style"))) }) as ExportStyle,
  });
}

/** The style everywhere it shows (the transcript, the captions, the files) changes at once; if the server refuses,
 *  the old style comes back. */
export function useUpdateStyle() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (patch: ExportStylePatch) => data(api.PATCH("/api/export/style", { body: patch })),
    onMutate: async (patch) => {
      await queryClient.cancelQueries({ queryKey: ["export-style"] });
      const before = queryClient.getQueryData<ExportStyle>(["export-style"]);
      if (before) queryClient.setQueryData<ExportStyle>(["export-style"], { ...before, ...(definedOnly(patch) as Partial<ExportStyle>) });
      return { before };
    },
    onError: (_e, _p, context) => {
      if (context?.before) queryClient.setQueryData(["export-style"], context.before);
    },
    onSuccess: (saved) => {
      queryClient.setQueryData(["export-style"], { ...DEFAULT_STYLE, ...saved });
      void queryClient.invalidateQueries({ queryKey: ["captions"] });
    },
  });
}

const definedOnly = <T extends object>(patch: T): Partial<T> =>
  Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined && v !== null)) as Partial<T>;

/** The brackets of each kind of quote, as the transcript draws them. */
export function bracketsOf(style: ExportStyle): Record<Kind, [string, string]> {
  return {
    quran: [style.quranBracketOpen, style.quranBracketClose],
    hadith: [style.hadithBracketOpen, style.hadithBracketClose],
    dhikr: [style.adhkarBracketOpen, style.adhkarBracketClose],
  };
}

export type ExportQuery = { script: "spoken" | "standard"; show: VerdictShown[]; kind: "all" | Kind };

/** The URL of one export file. `show` empty means every verdict. */
export function exportUrl(lectureId: number, format: ExportFormat, q: ExportQuery): string {
  const params = new URLSearchParams({ script: q.script, kind: q.kind });
  for (const v of q.show) params.append("show", v);
  return `/api/lectures/${lectureId}/export/${format}?${params}`;
}

/** One export file's text (the preview), read with the same query as the download. */
export function useExportText(lectureId: number, format: ExportFormat, q: ExportQuery, version: string) {
  return useQuery({
    queryKey: ["export-text", lectureId, format, q, version],
    meta: { silent: true },
    queryFn: async () => {
      const response = await globalThis.fetch(new Request(new URL(exportUrl(lectureId, format, q), window.location.origin)));
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      return response.text();
    },
  });
}
