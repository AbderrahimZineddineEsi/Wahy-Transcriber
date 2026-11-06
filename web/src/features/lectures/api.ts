import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api, data } from "../../api/client";
import type { components } from "../../api/schema";

export type Lecture = components["schemas"]["LectureSummary"];
export type LectureDetail = components["schemas"]["LectureDetail"];
export type Job = components["schemas"]["JobSnapshot"];
export type ModelInfo = components["schemas"]["ModelInfo"];
export type Started = components["schemas"]["wahy__features__transcription__schemas__Started"];
export type Findings = components["schemas"]["FindingsOut"];

export const UNFINISHED = ["queued", "running", "pausing", "paused", "cancelling"];
export const isUnfinished = (job: Job) => UNFINISHED.includes(job.status);

/** The generated types describe a file as a string; the body really is a FormData made by `multipart`. */
function multipart(fields: Record<string, string | boolean | Blob | null | undefined>) {
  const form = new FormData();
  for (const [name, value] of Object.entries(fields)) {
    if (value === null || value === undefined || value === "") continue;
    form.append(name, typeof value === "boolean" ? String(value) : value);
  }
  return { body: {} as never, bodySerializer: () => form };
}

export function useLectures() {
  return useQuery({ queryKey: ["lectures"], queryFn: () => data(api.GET("/api/lectures")) });
}

export function useLecture(id: number) {
  return useQuery({
    queryKey: ["lecture", id],
    queryFn: () => data(api.GET("/api/lectures/{lecture_id}", { params: { path: { lecture_id: id } } })),
    retry: false,
  });
}

export function useFindings(id: number) {
  return useQuery({
    queryKey: ["findings", id],
    queryFn: () => data(api.GET("/api/lectures/{lecture_id}/findings", { params: { path: { lecture_id: id } } })),
  });
}

export function useTranscriptionModels() {
  return useQuery({
    queryKey: ["transcription-models"],
    queryFn: () => data(api.GET("/api/transcription/models")),
  });
}

/** Recent jobs; polled every 2 s while one is unfinished, so a job started elsewhere shows up too. */
export function useJobs() {
  return useQuery({
    queryKey: ["jobs"],
    queryFn: () => data(api.GET("/api/jobs", { params: { query: { limit: 100 } } })),
    refetchInterval: (query) => (query.state.data?.some(isUnfinished) ? 2_000 : 10_000),
    meta: { silent: true },
  });
}

export function useJobAction(action: "pause" | "resume" | "cancel") {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      data(api.POST(`/api/jobs/{job_id}/${action}`, { params: { path: { job_id: id } } })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["jobs"] }),
  });
}

/** Start a detection job for a lecture (the quotes of its transcript). */
export async function startDetection(lectureId: number): Promise<Job> {
  const started = await data(
    api.POST("/api/lectures/{lecture_id}/detect", { params: { path: { lecture_id: lectureId } } }),
  );
  return started.job;
}

export type NewLecture =
  | { kind: "paste"; title: string; text: string }
  | { kind: "file"; title: string; file: File }
  | { kind: "youtube"; title: string; url: string; model: string | null; fallback: boolean }
  | { kind: "upload"; title: string; file: File; model: string | null; fallback: boolean }
  | { kind: "sample" };

/** Creates the lecture. Text lectures are ready at once, so their detection starts right away; the
 *  transcribed ones start detection when the transcription job ends (see JobWatcher). */
export function useCreateLecture() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: NewLecture): Promise<{ lecture: Lecture; job: Job | null }> => {
      const title = "title" in input && input.title.trim() ? input.title.trim() : null;
      switch (input.kind) {
        case "paste": {
          const lecture = await data(api.POST("/api/lectures", { body: { text: input.text, title, filename: "" } }));
          return { lecture, job: await startDetection(lecture.id) };
        }
        case "file": {
          const lecture = await data(
            api.POST("/api/lectures/import", multipart({ file: input.file, title })),
          );
          return { lecture, job: await startDetection(lecture.id) };
        }
        case "sample": {
          const lecture = await data(api.POST("/api/lectures/sample"));
          return { lecture, job: await startDetection(lecture.id) };
        }
        case "youtube": {
          const started = await data(
            api.POST("/api/transcriptions/youtube", {
              body: { url: input.url.trim(), title, model: input.model, auto_fallback: input.fallback },
            }),
          );
          return { lecture: started.lecture, job: started.job };
        }
        case "upload": {
          const started = await data(
            api.POST(
              "/api/transcriptions/upload",
              multipart({ file: input.file, title, model: input.model, auto_fallback: input.fallback }),
            ),
          );
          return { lecture: started.lecture, job: started.job };
        }
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["lectures"] });
      void queryClient.invalidateQueries({ queryKey: ["jobs"] });
    },
  });
}

export function useRenameLecture() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, title }: { id: number; title: string }) =>
      data(api.PATCH("/api/lectures/{lecture_id}", { params: { path: { lecture_id: id } }, body: { title } })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["lectures"] }),
  });
}

export function useDeleteLecture() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.DELETE("/api/lectures/{lecture_id}", { params: { path: { lecture_id: id } } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["lectures"] }),
  });
}

export function useDeleteAllLectures() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => data(api.DELETE("/api/lectures", { params: { query: { confirm: true } } })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["lectures"] }),
  });
}

export function useAttachMedia(id: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (file: File) =>
      data(
        api.PUT("/api/lectures/{lecture_id}/media", {
          params: { path: { lecture_id: id } },
          ...multipart({ file }),
        }),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["lectures"] });
      void queryClient.invalidateQueries({ queryKey: ["lecture", id] });
    },
  });
}

/** Follows one job's progress stream (server-sent events). `initial` shows until the first event arrives.
 *  The stream ends by itself when the job ends. */
export function useJobStream(initial: Job): Job {
  const [job, setJob] = useState(initial);
  const queryClient = useQueryClient();
  const finished = !isUnfinished(job);
  useEffect(() => {
    setJob((old) => (old.id === initial.id && old.updated_at >= initial.updated_at ? old : initial));
  }, [initial]);
  useEffect(() => {
    if (finished || typeof EventSource === "undefined") return;
    const source = new EventSource(`/api/jobs/${initial.id}/events`);
    source.addEventListener("job", (event) => {
      const next = JSON.parse((event as MessageEvent<string>).data) as Job;
      setJob(next);
      if (!isUnfinished(next)) {
        source.close();
        void queryClient.invalidateQueries({ queryKey: ["jobs"] });
        void queryClient.invalidateQueries({ queryKey: ["lectures"] });
        void queryClient.invalidateQueries({ queryKey: ["findings"] });
        void queryClient.invalidateQueries({ queryKey: ["lecture"] });
      }
    });
    source.onerror = () => source.close(); // the jobs list keeps polling, so the card still catches up
    return () => source.close();
  }, [initial.id, finished, queryClient]);
  return job;
}

// ---- the lecture screen (phase 12) ------------------------------------------------------------------------------

export type Version = components["schemas"]["VersionSummary"];
export type WordOut = components["schemas"]["WordOut"];

export function useVersions(id: number) {
  return useQuery({
    queryKey: ["versions", id],
    queryFn: () => data(api.GET("/api/lectures/{lecture_id}/versions", { params: { path: { lecture_id: id } } })),
  });
}

/** One saved version with its snapshot; nothing is fetched while `versionId` is null (the current findings). */
export function useVersion(id: number, versionId: number | null) {
  return useQuery({
    queryKey: ["version", id, versionId],
    enabled: versionId !== null,
    queryFn: () =>
      data(api.GET("/api/lectures/{lecture_id}/versions/{version_id}", { params: { path: { lecture_id: id, version_id: versionId! } } })),
  });
}

function useVersionMutation<A>(id: number, fn: (args: A) => Promise<unknown>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["versions", id] });
      void queryClient.invalidateQueries({ queryKey: ["lectures"] });
    },
  });
}

export function useSaveVersion(id: number) {
  return useVersionMutation(id, ({ name, snapshot }: { name: string; snapshot: Record<string, unknown> }) =>
    data(api.POST("/api/lectures/{lecture_id}/versions", { params: { path: { lecture_id: id } }, body: { name, snapshot } })),
  );
}

export function useRenameVersion(id: number) {
  return useVersionMutation(id, ({ versionId, name }: { versionId: number; name: string }) =>
    data(api.PATCH("/api/lectures/{lecture_id}/versions/{version_id}", { params: { path: { lecture_id: id, version_id: versionId } }, body: { name } })),
  );
}

export function useDeleteVersion(id: number) {
  // a refused delete (the last version) throws in the client's middleware, like every failed call
  return useVersionMutation(id, (versionId: number) =>
    api.DELETE("/api/lectures/{lecture_id}/versions/{version_id}", { params: { path: { lecture_id: id, version_id: versionId } } }),
  );
}

/** F-041: correct one word; its timing stays. The open lecture's cached words are updated in place. */
export function useEditWord(id: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ idx, text }: { idx: number; text: string }) =>
      data(api.PATCH("/api/lectures/{lecture_id}/words/{idx}", { params: { path: { lecture_id: id, idx } }, body: { text } })),
    onSuccess: (word: WordOut) => {
      queryClient.setQueryData<LectureDetail>(["lecture", id], (old) =>
        old ? { ...old, words: old.words.map((w) => (w.idx === word.idx ? word : w)) } : old,
      );
      // the fix is an edit in the lecture's log (undo takes it back), and the captions show it
      for (const key of ["edits", "captions", "export-text"]) void queryClient.invalidateQueries({ queryKey: [key, id] });
    },
  });
}
