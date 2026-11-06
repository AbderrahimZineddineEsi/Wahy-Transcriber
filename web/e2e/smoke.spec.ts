import { expect, test } from "@playwright/test";

test("the app opens, switches language and theme, and a saved key shows as set", async ({ page }) => {
  // opens, in Arabic and right to left
  await page.goto("/");
  await expect(page).toHaveURL(/\/lectures$/);
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.getByTestId("server-badge")).toHaveAttribute("data-state", "ok");

  // theme
  await page.getByRole("button", { name: "المظهر: فاتح أو داكن" }).click();
  const theme = await page.locator("html").getAttribute("data-theme");
  expect(["light", "dark"]).toContain(theme);

  // language: English, left to right, remembered after a reload
  await page.getByRole("button", { name: "اللغة" }).click();
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  await expect(page.getByRole("link", { name: "Settings" })).toBeVisible();
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme!);

  // a saved key shows as set; the page never shows the key
  await page.getByRole("link", { name: "Settings" }).click();
  const chip = page.getByTestId("key-gemini");
  await expect(chip).toHaveAttribute("data-set", "false");
  await page.getByLabel("Gemini API key").fill("gem-e2e-secret");
  await page.getByRole("form", { name: "Gemini" }).getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Gemini key saved")).toBeVisible();
  await expect(chip).toHaveAttribute("data-set", "true");
  expect(await page.content()).not.toContain("gem-e2e-secret");

  // the server's own health says the same, and never returns the key
  const health = await page.request.get("/api/health");
  const body = await health.json();
  expect(body.keys.gemini).toBe(true);
  expect(JSON.stringify(body)).not.toContain("gem-e2e-secret");
});
