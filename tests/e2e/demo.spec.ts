import { expect, test, type Page } from "@playwright/test";

async function expectNoHorizontalOverflow(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      ),
    )
    .toBeLessThanOrEqual(0);
}

function watchPageIssues(page: Page) {
  const issues: string[] = [];
  page.on("console", (message) => {
    const text = message.text();
    const isDelayedPreloadHeuristic =
      message.type() === "warning" &&
      text.includes("was preloaded using link preload but not used");
    if (
      message.type() === "error" ||
      (message.type() === "warning" && !isDelayedPreloadHeuristic)
    )
      issues.push(text);
  });
  page.on("pageerror", (error) => issues.push(error.message));
  return issues;
}

test("minimal landing enters the instrument", async ({ page }, testInfo) => {
  const pageIssues = watchPageIssues(page);
  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: "Every input leaves a trace." }),
  ).toBeVisible();
  await expect(
    page.getByText(/Compare how two input chains shape the same 20-second/),
  ).toBeVisible();
  await expect(page.locator(".experiment-stepper")).toHaveCount(0);
  await expectNoHorizontalOverflow(page);

  const begin = page.getByRole("link", { name: "Begin the comparison" });
  if (testInfo.project.name === "mobile") {
    const target = await begin.boundingBox();
    expect(target?.width).toBeGreaterThanOrEqual(44);
    expect(target?.height).toBeGreaterThanOrEqual(44);
  } else {
    await page.keyboard.press("Tab");
    await expect(
      page.getByRole("link", { name: "Signal Enhancer home" }),
    ).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(begin).toBeFocused();
  }

  await begin.click();
  await expect(page).toHaveURL(/\/lab$/);
  await page.locator('.app-shell[data-hydrated="true"]').waitFor();
  await expect(
    page.getByRole("heading", { name: "Listen to the chain." }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Signal Enhancer home" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(
    page.getByRole("heading", { name: "Every input leaves a trace." }),
  ).toBeVisible();
  expect(pageIssues).toEqual([]);
});

test("landing settles immediately with reduced motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");

  const title = page.getByRole("heading", {
    name: "Every input leaves a trace.",
  });
  await expect(title).toBeVisible();
  const activeAnimations = await page
    .getByRole("main")
    .evaluate(
      (element) =>
        element
          .getAnimations({ subtree: true })
          .filter((animation) => animation.playState === "running").length,
    );
  expect(activeAnimations).toBe(0);
  await expectNoHorizontalOverflow(page);
});

test("landing remains usable at 320 pixels", async ({ page }, testInfo) => {
  test.skip(
    testInfo.project.name !== "chromium",
    "One narrow-width audit is sufficient.",
  );
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: "Every input leaves a trace." }),
  ).toBeVisible();
  await expectNoHorizontalOverflow(page);
  const target = await page
    .getByRole("link", { name: "Begin the comparison" })
    .boundingBox();
  expect(target?.width).toBeGreaterThanOrEqual(44);
  expect(target?.height).toBeGreaterThanOrEqual(44);
});

test("landing keeps its action above the 1024 by 768 fold", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "chromium",
    "One intermediate-width audit is sufficient.",
  );
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto("/");

  const target = await page
    .getByRole("link", { name: "Begin the comparison" })
    .boundingBox();
  expect(target).not.toBeNull();
  expect((target?.y ?? 0) + (target?.height ?? 0)).toBeLessThanOrEqual(768);
  await expectNoHorizontalOverflow(page);
});

test("lab releases generated audio when returning home", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "chromium",
    "One route-exit resource audit is sufficient.",
  );
  await page.addInitScript(() => {
    const audit = { created: [] as string[], revoked: [] as string[] };
    const createObjectUrl = URL.createObjectURL.bind(URL);
    const revokeObjectUrl = URL.revokeObjectURL.bind(URL);
    Object.defineProperty(globalThis, "__signalObjectUrlAudit", {
      configurable: true,
      value: audit,
    });
    URL.createObjectURL = (blob) => {
      const url = createObjectUrl(blob);
      audit.created.push(url);
      return url;
    };
    URL.revokeObjectURL = (url) => {
      audit.revoked.push(url);
      revokeObjectUrl(url);
    };
  });

  await page.goto("/lab");
  await page.getByRole("button", { name: "About Signal Enhancer" }).click();
  await page
    .getByRole("button", { name: /Explore a prepared comparison/ })
    .click();
  await expect(
    page.getByRole("heading", { name: "Same sound. Different ears." }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            globalThis as typeof globalThis & {
              __signalObjectUrlAudit: { created: string[]; revoked: string[] };
            }
          ).__signalObjectUrlAudit.created.length,
      ),
    )
    .toBe(2);

  await page.getByRole("link", { name: "Signal Enhancer home" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const audit = (
          globalThis as typeof globalThis & {
            __signalObjectUrlAudit: { created: string[]; revoked: string[] };
          }
        ).__signalObjectUrlAudit;
        return audit.created.every((url) => audit.revoked.includes(url));
      }),
    )
    .toBe(true);
});

test("prepared comparison completes the honest browser-only journey", async ({
  page,
}, testInfo) => {
  const pageIssues = watchPageIssues(page);
  await page.goto("/lab");
  await page.locator('.app-shell[data-hydrated="true"]').waitFor();

  await expect(
    page.getByRole("heading", { name: "Listen to the chain." }),
  ).toBeVisible();
  await expectNoHorizontalOverflow(page);
  if (testInfo.project.name === "mobile") {
    const aboutTarget = await page
      .getByRole("button", { name: "About Signal Enhancer" })
      .boundingBox();
    expect(aboutTarget?.width).toBeGreaterThanOrEqual(44);
    expect(aboutTarget?.height).toBeGreaterThanOrEqual(44);
  }
  await expect(
    page.getByText("stays on this device until you upgrade"),
  ).toBeVisible();

  await page.getByRole("button", { name: "About Signal Enhancer" }).click();
  await expect(
    page.getByRole("dialog", { name: "Capture isn’t neutral." }),
  ).toBeVisible();
  await expect(page.locator("body")).toHaveCSS("overflow", "hidden");
  const closeAbout = page.getByRole("button", { name: "Close About" });
  const loadPreparedComparison = page.getByRole("button", {
    name: /Explore a prepared comparison/,
  });
  await expect(closeAbout).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(loadPreparedComparison).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(closeAbout).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("dialog", { name: "Capture isn’t neutral." }),
  ).toBeHidden();
  await expect(
    page.getByRole("button", { name: "About Signal Enhancer" }),
  ).toBeFocused();
  await expect(page.locator("body")).toHaveCSS("overflow", "visible");

  await page.getByRole("button", { name: "About Signal Enhancer" }).click();
  await page.locator(".dialog-backdrop").click({ position: { x: 5, y: 5 } });
  await expect(
    page.getByRole("dialog", { name: "Capture isn’t neutral." }),
  ).toBeHidden();
  await expect(
    page.getByRole("button", { name: "About Signal Enhancer" }),
  ).toBeFocused();

  await page.getByRole("button", { name: "About Signal Enhancer" }).click();
  await page
    .getByRole("button", { name: /Explore a prepared comparison/ })
    .click();

  await expect(
    page.getByRole("heading", { name: "Same sound. Different ears." }),
  ).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await expect(
    page.getByRole("img", { name: /Absolute waveform comparison/ }),
  ).toBeVisible();
  await expect(
    page.locator(".signal-plot:visible .plot-ruler text").last(),
  ).toHaveText("0:20");
  await expect(page.getByText("20:00", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Loudness matched" }).click();
  await page.getByRole("tab", { name: "Spectrum" }).click();
  await expect(
    page.getByRole("img", { name: /Loudness-matched spectrum comparison/ }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Dynamics" }).click();
  await expect(
    page.getByRole("img", { name: /Loudness-matched dynamics comparison/ }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Waveform" }).click();

  if (testInfo.project.name === "chromium") {
    await page.getByRole("button", { name: "Skip to end" }).click();
    await expect(page.getByLabel("Playback time")).toContainText("0:20.0");
    await page.getByRole("button", { name: "Return to start" }).click();
    await expect(page.getByLabel("Playback time")).toContainText("0:00.0");
  }

  await page.getByRole("button", { name: "Repeat captures" }).click();
  await expect(
    page.getByRole("heading", { name: "Hold the room still." }),
  ).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.getByRole("button", { name: "About Signal Enhancer" }).click();
  await page
    .getByRole("button", { name: /Explore a prepared comparison/ })
    .click();

  await page
    .getByRole("button", { name: /Upgrade Signal/ })
    .first()
    .click();
  await expect(
    page.getByRole("heading", { name: "Reshaping the signal." }),
  ).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await expect(
    page.getByText("No audio leaves this browser in demo mode."),
  ).toBeVisible();
  await expect(
    page
      .locator('.upgrade-stage-rail li[data-state="active"]')
      .filter({ hasText: "Restoring detail" }),
  ).toBeVisible({ timeout: 5_000 });
  await expect(page.getByRole("status")).toHaveAttribute("aria-live", "polite");
  await expect(page.getByRole("status")).toContainText("Restoring detail");

  await expect(
    page.getByRole("heading", { name: "A local preview, made visible." }),
  ).toBeVisible({ timeout: 8_000 });
  await expect(
    page.getByText("no AI model was used", { exact: false }),
  ).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.getByRole("tab", { name: "Spectrum" }).click();
  await expect(
    page.getByRole("img", { name: /spectrum comparison of the original/ }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Difference map" }).click();
  await expect(
    page.getByRole("img", { name: /difference comparison of the original/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: /Download preview WAV/ }),
  ).toHaveAttribute("download", "signal-enhancer-input-a.wav");
  await page.getByRole("button", { name: "Start a new experiment" }).click();
  await expect(
    page.getByRole("heading", { name: "Listen to the chain." }),
  ).toBeVisible();
  await expectNoHorizontalOverflow(page);
  expect(pageIssues).toEqual([]);
});
