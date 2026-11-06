// The editor's server calls (phase 16's routes). Every edit is one operation in the lecture's edit log, so after
// any edit (or an undo) the same five things are read again: the words, the findings, the log, the caption edits
// and the captions. `useEdit` does that once for every kind of edit.
import { keepPreviousData, useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { api, data } from "../../api/client";
import type { components } from "../../api/schema";

export type EditOp = components["schemas"]["OpOut"];
export type EditDone = components["schemas"]["EditDone"];
export type CaptionOut = components["schemas"]["CaptionOut"];
export type CaptionEdit = components["schemas"]["CaptionEdit"];
export type CaptionEditOut = components["schemas"]["CaptionEditOut"];
export type AddQuote = components["schemas"]["AddQuote"];
export type Suggestion = components["schemas"]["Suggestion"];
export type SearchHit = components["schemas"]["SearchHit"];
export type UnitWords = components["schemas"]["UnitWords"];
export type SourceType = "QURAN" | "HADITH" | "ADHKAR";
export type DeleteIntent = "ordinary_speech" | "highlight_mistake" | "testing";

/** One change to a finding (POST /api/findings/{id}/edit). */
export type FindingEdit =
  | { op: "move_edge"; edge: "start" | "end"; delta: number }
  | { op: "set_kind"; kind: "ayah" | "hadith" | "dhikr" }
  | { op: "snap"; on: boolean }
  | { op: "canonical_words"; indices: number[]; full?: boolean }
  | { op: "link_reference"; unit_id?: string | null; ref?: string }
  | { op: "add_candidate"; unit_id?: string | null; ref?: string }
  | { op: "remove_candidate"; unit_id: string }
  | { op: "merge"; direction: "previous" | "next"; gap_type?: "PART_OF_QUOTE" | "COMMENTARY" }
  | { op: "dismiss_merge"; direction: "previous" | "next" }
  | { op: "flag_reference"; wrong: boolean };

/** What an edit changes on screen. */
export function refreshLecture(queryClient: QueryClient, lectureId: number) {
  for (const key of ["lecture", "findings", "edits", "caption-edits", "captions", "export-text"]) {
    void queryClient.invalidateQueries({ queryKey: [key, lectureId] });
  }
}

/** The lecture's edit log, newest first (F-003: the undo button names the newest one). */
export function useEditLog(lectureId: number | null) {
  return useQuery({
    queryKey: ["edits", lectureId],
    enabled: lectureId !== null,
    meta: { silent: true },
    queryFn: () => data(api.GET("/api/lectures/{lecture_id}/edits", { params: { path: { lecture_id: lectureId! } } })),
  });
}

export function useUndo(lectureId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => data(api.POST("/api/lectures/{lecture_id}/edits/undo", { params: { path: { lecture_id: lectureId } } })),
    onSettled: () => refreshLecture(queryClient, lectureId),
  });
}

/** Any edit: run it, then read the lecture again. */
function useEdit<A>(lectureId: number, run: (args: A) => Promise<EditDone>) {
  const queryClient = useQueryClient();
  return useMutation({ mutationFn: run, onSettled: () => refreshLecture(queryClient, lectureId) });
}

const lecturePath = (lectureId: number) => ({ params: { path: { lecture_id: lectureId } } });

/** F-053: insert a missed quote over words start..end (inclusive). */
export const useAddQuote = (lectureId: number) =>
  useEdit(lectureId, (body: AddQuote) => data(api.POST("/api/lectures/{lecture_id}/edits/quote", { ...lecturePath(lectureId), body })));

/** F-058 to F-063 and N-007: one change to a finding. */
export const useEditFinding = (lectureId: number) =>
  useEdit(lectureId, ({ findingId, edit }: { findingId: number; edit: FindingEdit }) =>
    data(api.POST("/api/findings/{finding_id}/edit", { params: { path: { finding_id: findingId } }, body: edit as never })),
  );

/** F-064: delete a finding, saying why. */
export const useDeleteFinding = (lectureId: number) =>
  useEdit(lectureId, ({ findingId, intent }: { findingId: number; intent: DeleteIntent }) =>
    data(api.DELETE("/api/findings/{finding_id}", { params: { path: { finding_id: findingId }, query: { intent } } })),
  );

/** F-056: rewrite (or, with empty text, delete) words start..end. */
export const useReplaceWords = (lectureId: number) =>
  useEdit(lectureId, (body: { start: number; end: number; text: string }) =>
    data(api.POST("/api/lectures/{lecture_id}/edits/words", { ...lecturePath(lectureId), body })),
  );

/** F-067: save the full-text editor; unchanged words keep their times. */
export const useReplaceText = (lectureId: number) =>
  useEdit(lectureId, (text: string) => data(api.PUT("/api/lectures/{lecture_id}/edits/text", { ...lecturePath(lectureId), body: { text } })));

/** F-068: split, merge or re-time a caption. */
export const useCaptionEdit = (lectureId: number) =>
  useEdit(lectureId, (body: CaptionEdit) => data(api.POST("/api/lectures/{lecture_id}/edits/captions", { ...lecturePath(lectureId), body })));

/** The caption timing editor's saved edits, applied by the caption preview too. */
export function useCaptionEdits(lectureId: number) {
  return useQuery({
    queryKey: ["caption-edits", lectureId],
    meta: { silent: true },
    queryFn: () => data(api.GET("/api/lectures/{lecture_id}/edits/captions", lecturePath(lectureId))),
  });
}

export type CaptionQuery = { script: "spoken" | "standard" };

/** The captions exactly as the caption files write them (F-068's table). */
export function useCaptions(lectureId: number, query: CaptionQuery) {
  return useQuery({
    queryKey: ["captions", lectureId, query],
    placeholderData: keepPreviousData,
    queryFn: () => data(api.GET("/api/lectures/{lecture_id}/captions", { params: { path: { lecture_id: lectureId }, query } })),
  });
}

// ---- the corpus ---------------------------------------------------------------------------------------------------

/** F-052: the closest references for the selected words (and what the user typed). */
export function useSuggestions(text: string, kind: SourceType, query: string, enabled: boolean) {
  return useQuery({
    queryKey: ["suggest", text, kind, query],
    enabled: enabled && Boolean(text.trim() || query.trim()),
    placeholderData: keepPreviousData,
    meta: { silent: true },
    queryFn: async ({ signal }) => {
      await new Promise((resolve) => setTimeout(resolve, 200)); // typing must not send a request per key
      if (signal.aborted) throw new Error("superseded");
      return data(api.GET("/api/corpus/suggest", { params: { query: { text, kind, query, limit: 12 } } }));
    },
  });
}

/** F-061: corpus search by reference or words, for linking a reference. */
export function useCorpusSearch(q: string, kind: "ALL" | SourceType, enabled: boolean) {
  return useQuery({
    queryKey: ["corpus-search", q, kind],
    enabled: enabled && Boolean(q.trim()),
    placeholderData: keepPreviousData,
    meta: { silent: true },
    queryFn: async ({ signal }) => {
      await new Promise((resolve) => setTimeout(resolve, 200));
      if (signal.aborted) throw new Error("superseded");
      return data(api.GET("/api/corpus/search", { params: { query: { q, kind, limit: 20 } } }));
    },
  });
}

/** F-050, F-062: the words of some corpus units (a hadith's chain too). */
export function useUnits(ids: string[]) {
  const wanted = ids.filter((id) => id && id !== "OUTSIDE_CORPUS" && !id.startsWith("MANUAL:"));
  return useQuery({
    queryKey: ["units", wanted],
    enabled: wanted.length > 0,
    staleTime: Infinity,
    meta: { silent: true },
    queryFn: () => data(api.GET("/api/corpus/units", { params: { query: { ids: wanted } } })),
  });
}

/** F-054: save some words as a dhikr in the adhkar list (the next detection finds it). */
export function useSaveDhikr() {
  return useMutation({
    mutationFn: ({ text, name }: { text: string; name: string }) =>
      data(api.POST("/api/corpora/adhkar", { body: { t: text, ref: name || text, category: "أذكار متفرقة" } })),
  });
}
