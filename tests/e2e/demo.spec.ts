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

async function openPreparedReview(page: Page) {
  await page.goto("/lab");
  await page.locator('.app-shell[data-hydrated="true"]').waitFor();
  await page.getByRole("button", { name: "About Signal Enhancer" }).click();
  await page.getByRole("button", { name: /Explore a prepared review/ }).click();
  await expect(
    page.getByRole("heading", { name: "One input under the lens." }),
  ).toBeVisible();
}

function visibleSignalPlot(page: Page) {
  return page.locator(".signal-plot:visible");
}

test("minimal landing enters the instrument", async ({ page }, testInfo) => {
  const pageIssues = watchPageIssues(page);
  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: "Every input leaves a trace." }),
  ).toBeVisible();
  await expect(
    page.getByText(/Read one 20-second passage through two input chains/),
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
    page.getByRole("heading", { name: "Prepare your reading." }),
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

  await openPreparedReview(page);
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

test("prepared review inspects and plays only one capture at a time", async ({
  page,
}, testInfo) => {
  const pageIssues = watchPageIssues(page);
  await openPreparedReview(page);
  await expectNoHorizontalOverflow(page);

  const trackSelector = page.getByRole("tablist", {
    name: "Choose one capture to inspect",
  });
  const inputA = trackSelector.getByRole("tab", { name: /Input A/ });
  const inputB = trackSelector.getByRole("tab", { name: /Input B/ });
  await expect(inputA).toHaveAttribute("aria-selected", "true");
  await expect(inputB).toHaveAttribute("aria-selected", "false");
  await expect(page.getByText("Viewing Input A only")).toBeVisible();

  const plot = visibleSignalPlot(page);
  await expect(plot.locator(".plot-track")).toHaveCount(1);
  await expect(plot.locator(".plot-track > text").first()).toHaveText(
    "Input A",
  );
  await expect(
    page.getByRole("img", {
      name: "Input A waveform for the guided reading",
    }),
  ).toBeVisible();
  await expect(plot.locator(".plot-segment")).toHaveCount(4);
  await expect(plot.locator(".plot-segment").first()).toContainText("Room");
  await expect(plot.locator(".plot-segment").last()).toContainText("Natural");
  await expect(plot.locator(".plot-ruler text").first()).toHaveText("0:00");
  await expect(plot.locator(".plot-ruler text").last()).toHaveText("0:20");
  await expect(page.getByRole("button", { name: /Play both/i })).toHaveCount(0);
  await expect(page.getByText("Synchronized playback")).toHaveCount(0);

  const waveformPath = await plot.locator(".plot-track path").getAttribute("d");
  expect(waveformPath).toBeTruthy();

  const viewTabs = page.getByRole("tablist", {
    name: "Input A evidence view",
  });
  const waveformTab = viewTabs.getByRole("tab", { name: "Waveform" });
  await waveformTab.focus();
  await page.keyboard.press("ArrowRight");
  const spectrumTab = viewTabs.getByRole("tab", { name: "Spectrum" });
  await expect(spectrumTab).toBeFocused();
  await expect(spectrumTab).toHaveAttribute("aria-selected", "true");
  const spectrumPanelId = await spectrumTab.getAttribute("aria-controls");
  expect(spectrumPanelId).toBeTruthy();
  await expect(page.locator(`#${spectrumPanelId}`)).toBeVisible();
  await expect(
    page.getByRole("img", {
      name: "Input A spectrum for the guided reading",
    }),
  ).toBeVisible();
  await expect(plot.locator(".plot-segment")).toHaveCount(0);
  await expect(plot.locator(".playhead")).toHaveCount(0);
  await expect(plot.locator(".active-gate")).toHaveCount(0);
  await expect(plot.locator(".plot-ruler text").first()).toHaveText("20 Hz");
  await expect(plot.locator(".plot-ruler text").last()).toContainText("kHz");
  await expect(plot).not.toContainText("No spectrum evidence available");

  await page.keyboard.press("ArrowRight");
  const dynamicsTab = viewTabs.getByRole("tab", { name: "Dynamics" });
  await expect(dynamicsTab).toBeFocused();
  await expect(dynamicsTab).toHaveAttribute("aria-selected", "true");
  await expect(
    page.getByRole("img", {
      name: "Input A dynamics for the guided reading",
    }),
  ).toBeVisible();
  await expect(plot.locator(".plot-segment")).toHaveCount(4);
  await expect(plot.locator(".plot-ruler text").first()).toHaveText("0:00");
  await expect(plot.locator(".plot-ruler text").last()).toHaveText("0:20");
  await expect(plot).not.toContainText("No dynamics evidence available");
  const dynamicsPath = await plot.locator(".plot-track path").getAttribute("d");
  expect(dynamicsPath).toBeTruthy();
  expect(dynamicsPath).not.toBe(waveformPath);

  await page.keyboard.press("Home");
  await expect(waveformTab).toBeFocused();
  await expect(waveformTab).toHaveAttribute("aria-selected", "true");

  await page.getByRole("button", { name: "Play Input A" }).click();
  await expect(
    page.getByRole("button", { name: "Pause Input A" }),
  ).toBeVisible();
  await inputB.click();
  await expect(inputB).toHaveAttribute("aria-selected", "true");
  await expect(inputA).toHaveAttribute("aria-selected", "false");
  await expect(page.getByText("Viewing Input B only")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Play Input B" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /Pause Input/ })).toHaveCount(
    0,
  );
  await expect(page.getByLabel("Playback time")).toContainText("0:00.0");
  await expect(plot.locator(".plot-track")).toHaveCount(1);
  await expect(plot.locator(".plot-track > text").first()).toHaveText(
    "Input B",
  );
  await expect(
    page.getByRole("img", {
      name: "Input B waveform for the guided reading",
    }),
  ).toBeVisible();

  await page.getByRole("button", { name: /Jump to Soft but clear/ }).click();
  await expect(page.getByLabel("Playback time")).toContainText("0:08.0");
  const rangedFinding = page
    .locator('.track-insight[aria-label^="Jump to 0:02"]')
    .first();
  await expect(rangedFinding).toBeVisible();
  await rangedFinding.click();
  await expect(page.getByLabel("Playback time")).toContainText("0:02.0");

  if (testInfo.project.name === "mobile") {
    const findingDetail = page.locator(".track-insight-copy > span").first();
    await expect(findingDetail).toBeVisible();
    expect((await findingDetail.textContent())?.trim().length).toBeGreaterThan(
      24,
    );
    const findingTarget = await rangedFinding.boundingBox();
    expect(findingTarget?.height).toBeGreaterThanOrEqual(44);
  }

  await expectNoHorizontalOverflow(page);
  expect(pageIssues).toEqual([]);
});

test("a delayed playback request cannot restart after the user switches inputs", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "chromium",
    "One playback race audit is sufficient.",
  );
  await page.addInitScript(() => {
    const audit = { active: 0, maximumActive: 0 };
    const activeSources = new WeakSet<AudioBufferSourceNode>();
    Object.defineProperty(globalThis, "__signalPlaybackAudit", {
      configurable: true,
      value: audit,
    });

    const originalResume = AudioContext.prototype.resume;
    AudioContext.prototype.resume = async function resumeWithDelayedResult() {
      const result = originalResume.call(this);
      await new Promise((resolve) => window.setTimeout(resolve, 500));
      return result;
    };

    const originalStart = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function auditedStart(...args) {
      activeSources.add(this);
      audit.active += 1;
      audit.maximumActive = Math.max(audit.maximumActive, audit.active);
      return Reflect.apply(originalStart, this, args);
    };

    const originalStop = AudioBufferSourceNode.prototype.stop;
    AudioBufferSourceNode.prototype.stop = function auditedStop(...args) {
      if (activeSources.delete(this)) audit.active -= 1;
      return Reflect.apply(originalStop, this, args);
    };
  });

  await openPreparedReview(page);
  await page.getByRole("button", { name: "Play Input A" }).click();
  await page
    .getByRole("tablist", { name: "Choose one capture to inspect" })
    .getByRole("tab", { name: /Input B/ })
    .click();
  await page.getByRole("button", { name: "Play Input B" }).click();

  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            globalThis as typeof globalThis & {
              __signalPlaybackAudit: { maximumActive: number };
            }
          ).__signalPlaybackAudit.maximumActive,
      ),
    )
    .toBe(1);
});

test("prepared review completes the honest browser-only journey", async ({
  page,
}, testInfo) => {
  const pageIssues = watchPageIssues(page);
  await page.goto("/lab");
  await page.locator('.app-shell[data-hydrated="true"]').waitFor();

  await expect(
    page.getByRole("heading", { name: "Prepare your reading." }),
  ).toBeVisible();
  await expect(
    page.getByText("Practice is silent and not recorded."),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Beyond the quiet room, clear voices travel through glass and open air.",
    ),
  ).toBeVisible();
  await expect(page.locator(".reading-cues > li")).toHaveCount(4);
  await page.getByRole("button", { name: "Practice the timing" }).click();
  await expect(
    page.locator('.reading-cues > li[data-cue="room-tone"]'),
  ).toHaveAttribute("aria-current", "step");
  await page.getByRole("button", { name: "Pause practice" }).click();
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
  const loadPreparedReview = page.getByRole("button", {
    name: /Explore a prepared review/,
  });
  await expect(closeAbout).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(loadPreparedReview).toBeFocused();
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
  await page.getByRole("button", { name: /Explore a prepared review/ }).click();

  await expect(
    page.getByRole("heading", { name: "One input under the lens." }),
  ).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await expect(page.getByText("Viewing Input A only")).toBeVisible();

  await page.getByRole("button", { name: "Repeat both captures" }).click();
  await expect(
    page.getByRole("heading", {
      name: "Read one measured passage.",
      level: 1,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Start three-second count-in" }),
  ).toBeVisible();
  await expect(page.getByText("No reading during this cue.")).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.getByRole("button", { name: "About Signal Enhancer" }).click();
  await page.getByRole("button", { name: /Explore a prepared review/ }).click();

  await page.getByRole("button", { name: "Upgrade Input A" }).first().click();
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
    page.getByRole("heading", { name: "Prepare your reading." }),
  ).toBeVisible();
  await expectNoHorizontalOverflow(page);
  expect(pageIssues).toEqual([]);
});
