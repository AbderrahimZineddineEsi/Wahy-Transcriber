import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { api, data } from "../../api/client";
import { startDetection, useJobs } from "./api";

/** Runs in the layout, so it works on every screen: when a transcription job finishes, start detection for
 *  its lecture (the server runs the two as separate jobs). It starts one only if the lecture has no
 *  detection job yet and no findings, so a page reload never repeats it. */
export function JobWatcher() {
  const jobs = useJobs();
  const queryClient = useQueryClient();
  const started = useRef(new Set<number>());

  useEffect(() => {
    const all = jobs.data ?? [];
    for (const job of all) {
      const id = job.lecture_id;
      if (job.kind !== "transcribe" || job.status !== "done" || id === null) continue;
      if (started.current.has(id) || all.some((j) => j.kind === "detect" && j.lecture_id === id)) continue;
      started.current.add(id);
      void (async () => {
        try {
          const found = await data(api.GET("/api/lectures/{lecture_id}/findings", { params: { path: { lecture_id: id } } }));
          if (found.count === 0) await startDetection(id);
        } catch {
          started.current.delete(id); // try again at the next poll; the next poll's error would only repeat
        } finally {
          void queryClient.invalidateQueries({ queryKey: ["jobs"] });
        }
      })();
    }
  }, [jobs.data, queryClient]);

  return null;
}
