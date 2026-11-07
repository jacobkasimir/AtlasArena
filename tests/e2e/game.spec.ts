import { expect, test, type Page } from "@playwright/test";

async function startGuest(page:Page){
  await page.goto("/");
  await page.getByLabel("Username").fill(`Explorer${Math.floor(Math.random()*100000)}`);
  await page.getByRole("button", { name: "Continue to Atlas Arena" }).click();
  await expect(page.getByText("Choose your challenge", {exact:true})).toBeVisible();
}

test("guest completes Classic, reviews results, refreshes without extra XP", async ({ page }) => {
  await startGuest(page);
  await page.getByRole("button", { name: "Start adventure", exact: false }).click();
  await expect(page.locator("button.answer").first()).toBeVisible();
  await page.screenshot({path:`test-results/atlas-game-${test.info().project.name}.png`});
  for (let i = 0; i < 10; i++) {
    await page.locator("button.answer").first().click();
    if (i < 9) await page.getByRole("button", { name: "Next question", exact: false }).click();
  }
  await expect(page).toHaveURL(/\/results\//);
  await expect(page.getByText("Your answer review", { exact: true })).toBeVisible();
  const xpValue = page.getByText("XP earned", { exact: true }).locator("..").locator("p").nth(1);
  const xp = await xpValue.innerText();
  await page.reload();
  await expect(page.getByText("XP earned", { exact: true }).locator("..").locator("p").nth(1)).toHaveText(xp);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("Practice has no countdown", async ({ page }) => {
  await startGuest(page);
  await page.locator('input[name="mode"][value="practice"]').check({force:true});
  await page.getByRole("button", { name: "Start adventure", exact: false }).click();
  await expect(page.locator("button.answer").first()).toBeVisible();
  await expect(page.getByText("Time left", { exact: true })).toHaveCount(0);
});

test("Timed completes after the actual demo deadline", async ({ page }) => {
  await startGuest(page);
  await page.locator('input[name="mode"][value="timed"]').check({force:true});
  await page.getByRole("button", { name: "Start adventure", exact: false }).click();
  await expect(page.getByText("Time left", { exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/results\//, { timeout: 70000 });
});

test("demo does not pretend to provide admin operations", async ({ page }) => {
  await startGuest(page);
  await page.goto("/admin");
  await expect(page.getByText(/Administration requires Supabase/)).toBeVisible();
});

test("home stays within desktop, tablet, and narrow phone viewports", async ({ page }) => {
  await page.setViewportSize({width:320,height:780});
  await startGuest(page);
  for (const width of [320, 375, 768, 1024, 1440]) {
    await page.setViewportSize({width,height:900});
    await expect(page.getByText("Choose your challenge", {exact:true})).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    if (width===320||width===1440) await page.screenshot({path:`test-results/atlas-home-${width}-${test.info().project.name}.png`});
  }
});

test("number keys can select an answer", async ({ page }) => {
  await startGuest(page);
  await page.getByRole("button", { name: "Start adventure", exact: false }).click();
  await expect(page.locator("button.answer").first()).toBeVisible();
  await page.keyboard.press("1");
  await expect(page.locator(".feedback-card")).toBeVisible();
});
