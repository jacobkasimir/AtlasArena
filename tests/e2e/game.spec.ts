import { expect, test } from "@playwright/test";

test("guest completes Classic, reviews results, refreshes without extra XP", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Play as Guest", exact: false }).click();
  await page.getByRole("button", { name: "Start adventure", exact: false }).click();
  for (let i = 0; i < 10; i++) {
    await page.locator("button.answer").first().click();
    if (i < 9) await page.getByRole("button", { name: "Next question", exact: false }).click();
  }
  await expect(page).toHaveURL(/\/results\//);
  await expect(page.getByText("Your answer review", { exact: true })).toBeVisible();
  const xp = await page.getByText("XP earned", { exact: true }).locator("..").innerText();
  await page.reload();
  await expect(page.getByText("XP earned", { exact: true }).locator("..")).toHaveText(xp);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("Practice has no countdown", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Play as Guest", exact: false }).click();
  await page.getByRole("radio", { name: /Practice/ }).check();
  await page.getByRole("button", { name: "Start adventure", exact: false }).click();
  await expect(page.locator("button.answer").first()).toBeVisible();
  await expect(page.getByText("Time left", { exact: true })).toHaveCount(0);
});

test("Timed completes after the actual demo deadline", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Play as Guest", exact: false }).click();
  await page.getByRole("radio", { name: /Timed Challenge/ }).check();
  await page.getByRole("button", { name: "Start adventure", exact: false }).click();
  await expect(page.getByText("Time left", { exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/results\//, { timeout: 70000 });
});

test("demo does not pretend to provide admin operations", async ({ page }) => {
  await page.goto("/admin");
  await expect(page.getByText(/Administration requires Supabase/)).toBeVisible();
});
