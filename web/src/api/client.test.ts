import { afterEach, expect, test, vi } from "vitest";
import { ApiError, api, describeDetail, recentRequests } from "./client";

afterEach(() => vi.unstubAllGlobals());

test("describeDetail reads FastAPI's text and validation details", () => {
  expect(describeDetail({ detail: "no job 7" })).toBe("no job 7");
  expect(describeDetail({ detail: [{ loc: ["body", "value"], msg: "field required" }] })).toBe("body.value: field required");
  expect(describeDetail({})).toBe("");
});

test("an error status becomes an ApiError with the endpoint and the server's words", async () => {
  vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ detail: "no job 7" }), { status: 404 }));
  const error = await api.GET("/api/jobs/{job_id}", { params: { path: { job_id: "7" } } }).catch((e) => e);
  expect(error).toBeInstanceOf(ApiError);
  expect(error).toMatchObject({ status: 404, method: "GET", endpoint: "/api/jobs/7", detail: "no job 7", message: "no job 7" });
  expect(recentRequests().at(-1)).toMatchObject({ method: "GET", endpoint: "/api/jobs/7", status: 404 });
});

test("a server that does not answer becomes a network ApiError", async () => {
  vi.stubGlobal("fetch", async () => {
    throw new TypeError("Failed to fetch");
  });
  const error = await api.GET("/api/health").catch((e) => e);
  expect(error).toBeInstanceOf(ApiError);
  expect(error.isNetwork).toBe(true);
});
