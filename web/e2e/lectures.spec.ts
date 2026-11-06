import { expect, test } from "@playwright/test";

const SRT = `1
00:00:00,000 --> 00:00:04,000
إن الحمد لله نحمده ونستعينه ونستغفره

2
00:00:04,000 --> 00:00:10,000
قال الله تعالى الحمد لله رب العالمين الرحمن الرحيم مالك يوم الدين
`;

test("an .srt file becomes a lecture with findings; it can be renamed and deleted", async ({ page }) => {
  await page.goto("/lectures");
  await page.getByRole("button", { name: /ملف نصي/ }).click();
  await page.locator("#text-file").setInputFiles({ name: "khutba.srt", mimeType: "text/plain", buffer: Buffer.from(SRT) });
  await page.getByLabel("العنوان · اختياري").fill("خطبة اختبار");
  await page.getByRole("button", { name: "إنشاء المحاضرة" }).click();

  // the saved list shows it, and the detection job reaches done
  const row = page.getByTestId("lecture-row").filter({ hasText: "خطبة اختبار" });
  await expect(row).toBeVisible();
  const job = page.getByTestId("job-detect");
  await expect(job).toHaveAttribute("data-status", "done", { timeout: 60_000 });

  // open it: the transcript and the verses found
  await job.getByRole("link", { name: "فتح المحاضرة" }).click();
  await expect(page.getByTestId("transcript")).toContainText("الحمد لله رب العالمين");
  await expect(page.getByTestId("transcript").locator(".ref").first()).toContainText(/الفاتحة|1:/);

  // rename, then delete: the list shows exactly what is left
  await page.getByRole("navigation", { name: "التنقل" }).getByRole("link", { name: "المحاضرات", exact: true }).click();
  await row.getByRole("button", { name: "إعادة تسمية" }).click();
  await page.getByLabel("العنوان الجديد").fill("خطبة معاد تسميتها");
  await page.getByLabel("العنوان الجديد").press("Enter");
  await expect(page.getByTestId("lecture-row").filter({ hasText: "خطبة معاد تسميتها" })).toBeVisible();
  await page.getByTestId("lecture-row").filter({ hasText: "خطبة معاد تسميتها" }).getByRole("button", { name: "حذف" }).click();
  await page.getByRole("button", { name: "تأكيد الحذف" }).click();
  await expect(page.getByTestId("lecture-row").filter({ hasText: "خطبة معاد تسميتها" })).toHaveCount(0);
});
