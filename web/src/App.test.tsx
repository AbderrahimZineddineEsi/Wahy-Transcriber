import { render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { App } from "./App";

afterEach(() => vi.unstubAllGlobals());

test("shows the server health", async () => {
  vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ status: "ok" })));
  render(<App />);
  expect(await screen.findByText("server: ok")).toBeTruthy();
});
