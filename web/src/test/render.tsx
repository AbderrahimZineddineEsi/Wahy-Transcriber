import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { vi } from "vitest";
import { App } from "../App";
import type { Health } from "../api/health";
import { Providers } from "../shell/Providers";

export const healthy: Health = {
  status: "ok",
  keys: { groq: false, gemini: false, openrouter: false, jev: false },
  gpu: { card: null, total_mb: null, free_mb: null, resident: null, in_use: null, waiting: [] },
  engine: { running: false, starts: 0, calls: 0 },
  corpus: { ready: true, hadith_source: "sunnah" },
  running_jobs: 0,
};

export type Call = { method: string; path: string; body: unknown; search?: string };
export type Handler = (call: Call) => Response | Promise<Response> | undefined;

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function parseBody(text: string, type: string): unknown {
  if (!text) return undefined;
  return type.includes("json") ? JSON.parse(text) : text; // multipart bodies stay raw text
}

/** Replace fetch with a fake server. `handler` may answer a call; health answers 200 `health()` otherwise. */
export function fakeServer(handler: Handler = () => undefined, health: () => Health = () => healthy) {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", async (request: Request) => {
    const url = new URL(request.url);
    const text = request.method === "GET" ? "" : await request.clone().text();
    const call: Call = { method: request.method, path: url.pathname, body: parseBody(text, request.headers.get("content-type") ?? ""), search: url.search };
    calls.push(call);
    const answer = await handler(call);
    if (answer) return answer;
    if (call.method === "GET" && call.path === "/api/health") return json(health());
    return json({ detail: `no fake for ${call.method} ${call.path}` }, 404);
  });
  return calls;
}

export function renderApp(path = "/lectures") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Providers>
        <App />
      </Providers>
    </MemoryRouter>,
  );
}
