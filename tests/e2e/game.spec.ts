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
  await expect(page.locator(".game-review")).toBeVisible();
});

test("Explorer filters, opens details, and stays usable in both themes on a phone", async ({ page }) => {
  await startGuest(page);
  await page.getByRole("link", { name: "Explorer", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Every place has a story." })).toBeVisible();
  await expect(page.locator(".country-card").first()).toBeVisible();

  const region = page.getByRole("combobox", { name: "Region" });
  await region.focus();
  await page.keyboard.press("Space");
  await page.screenshot({ path: `test-results/atlas-explorer-dropdown-${test.info().project.name}.png` });
  await page.keyboard.press("Escape");
  await region.selectOption({ index: 1 });
  await expect(page.getByRole("status")).toContainText("of");
  await page.getByRole("button", { name: "Sort by region, then name" }).click();
  await page.locator("details summary").first().click();
  await expect(page.locator("details[open]").first()).toBeVisible();

  for (const theme of ["light", "dark"]) {
    await page.evaluate(value => { document.documentElement.dataset.theme = value; }, theme);
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await page.screenshot({ path: `test-results/atlas-explorer-${theme}-${test.info().project.name}.png` });
  }

  await page.setViewportSize({ width: 320, height: 780 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: `test-results/atlas-explorer-mobile-${test.info().project.name}.png` });
});

test("Flags keeps its option grid and feedback stable across a reload", async ({ page }) => {
  await startGuest(page);
  await page.getByRole("link", { name: "Flags", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Flags", exact: true })).toBeVisible();
  await expect(page.locator(".flags-pool-summary strong")).toHaveText("12 eligible flags");
  const regionMenu=page.getByRole("button",{name:"Region All regions"});
  await regionMenu.focus();await page.keyboard.press("Enter");await page.keyboard.press("ArrowDown");await page.keyboard.press("ArrowDown");await page.keyboard.press("Enter");
  await expect(page.locator(".flags-pool-summary strong")).toHaveText("2 eligible flags");
  await page.getByRole("button",{name:"Region Asia"}).click();
  await page.getByRole("option",{name:/All regions/}).click();
  await page.getByRole("radio",{name:/All flags/}).check();
  await page.getByRole("radio",{name:/Easy flags/}).check();
  await page.getByRole("button", { name: "Start full round" }).click();
  await expect(page.getByText("FIND THIS COUNTRY’S FLAG")).toBeVisible();
  const target = await page.evaluate(() => {
    const store = JSON.parse(localStorage.getItem("atlas-flags-demo-v1") || "{}");
    const session = store.sessions.at(-1);
    const target = session.current.id;
    const options = [...session.entries].sort((a, b) => a.choicePosition - b.choicePosition);
    return { target, wrongPosition: options.findIndex(entry => entry.id !== target) + 1,
      rightPosition: options.findIndex(entry => entry.id === target) + 1 };
  });
  await page.getByRole("button", { name: "Flag option 1", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("button", { name: "Flag option 2", exact: true })).toBeFocused();
  await page.getByRole("button", { name: `Flag option ${target.wrongPosition}`, exact: true }).click();
  await expect(page.getByRole("status")).toContainText("2 attempts remaining");
  await expect(page.getByRole("button", { name: new RegExp(`^Flag option ${target.wrongPosition}, incorrect selection$`) })).toBeDisabled();
  await page.reload();
  await expect(page.getByRole("status")).toContainText("2 attempts remaining");
  await page.getByRole("button", { name: `Flag option ${target.rightPosition}`, exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Correct · second try · 60 points");
  await page.getByRole("button", { name: "Next flag" }).click();
  await expect(page.getByText("2 of 12")).toBeVisible();
  for (const theme of ["light", "dark"]) {
    await page.evaluate(value => { document.documentElement.dataset.theme = value; }, theme);
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
  }
  await page.setViewportSize({ width: 320, height: 780 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("Save and leave pauses the clock and saved rounds can be deleted", async ({ page }) => {
  await startGuest(page);
  await page.getByRole("link", { name: "Flags", exact: true }).click();
  await page.getByRole("button", { name: "Start full round" }).click();
  await expect(page.getByRole("button",{name:"Save and leave"})).toBeVisible();
  await page.waitForTimeout(1100);
  await page.getByRole("button",{name:"Save and leave"}).click();
  await expect(page.getByRole("heading",{name:"Resume a saved round"})).toBeVisible();
  const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem("atlas-flags-demo-v1")||"{}").sessions.at(-1));
  expect(saved.state).toBe("paused");
  const elapsed=saved.elapsedMs;
  await page.waitForTimeout(1000);
  const stillPaused=await page.evaluate(()=>JSON.parse(localStorage.getItem("atlas-flags-demo-v1")||"{}").sessions.at(-1));
  expect(stillPaused.elapsedMs).toBe(elapsed);
  await page.getByRole("button",{name:"Delete",exact:true}).click();
  await page.getByRole("button",{name:"Delete round",exact:true}).click();
  await expect(page.getByText("Your saved rounds will appear here.")).toBeVisible();
});

test("Flag to Country supports hints, skip, and result review without XP", async ({ page }) => {
  await startGuest(page);
  await page.getByRole("link", { name: "Flags", exact: true }).click();
  await page.getByLabel(/Flag → Country/).check();
  await page.getByRole("button", { name: "Start full round" }).click();
  await expect(page.getByRole("button", { name: /Show region hint/ })).toBeVisible();
  await page.getByRole("button", { name: /Show region hint/ }).click();
  await expect(page.getByText(/^Region:/)).toBeVisible();
  await page.getByRole("button", { name: "Skip", exact: true }).click();
  await expect(page.locator(".flags-feedback[role=status]")).toContainText("Skipped · 0 points");
  for (let i = 1; i < 12; i++) {
    await page.getByRole("button", { name: "Next flag" }).click();
    await page.getByRole("button", { name: "Skip", exact: true }).click();
  }
  await page.getByRole("button", { name: "View results" }).click();
  await expect(page.getByRole("heading", { name: "Your results" })).toBeVisible();
  await expect(page.getByText("First completed run")).toBeVisible();
  await expect(page.locator(".flags-result-score strong")).toContainText("/ 1160");
  await expect(page.getByText("Region hints used: 1.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Question review" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
