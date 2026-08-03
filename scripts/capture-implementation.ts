import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

import { chromium, type Page } from "@playwright/test";

const baseUrl = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000";
const outputDirectory = resolve(
  process.cwd(),
  process.env.VISUAL_OUTPUT_DIR ?? "docs/brand-redesign/implementation",
);

async function waitForStageMotion(page: Page) {
  await page.locator(".stage").evaluate(async (element) => {
    await Promise.all(
      element
        .getAnimations({ subtree: true })
        .map((animation) => animation.finished),
    );
  });
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement)
      document.activeElement.blur();
    window.scrollTo(0, 0);
  });
  await page.waitForFunction(() => window.scrollY === 0);
}

async function waitForLandingMotion(page: Page) {
  await page.getByRole("main").evaluate(async (element) => {
    await Promise.all(
      element
        .getAnimations({ subtree: true })
        .map((animation) => animation.finished),
    );
  });
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement)
      document.activeElement.blur();
    window.scrollTo(0, 0);
  });
  await page.waitForFunction(() => window.scrollY === 0);
}

async function openLanding(page: Page) {
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await page
    .getByRole("heading", { name: "Every input leaves a trace." })
    .waitFor();
}

async function openApp(page: Page) {
  await page.goto(`${baseUrl}/lab`, { waitUntil: "domcontentloaded" });
  await page.locator('.app-shell[data-hydrated="true"]').waitFor();
}

async function openPreparedReview(page: Page) {
  await openApp(page);
  await page.getByRole("button", { name: "About Signal Enhancer" }).click();
  await page.getByRole("button", { name: /Explore a prepared review/ }).click();
  await page
    .getByRole("heading", { name: "One input under the lens." })
    .waitFor();
  await waitForStageMotion(page);
}

async function captureDesktop() {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({
      viewport: { width: 1536, height: 1024 },
      deviceScaleFactor: 1,
    });

    await openLanding(page);
    await waitForLandingMotion(page);
    await page.screenshot({
      path: resolve(outputDirectory, "00-home-desktop.png"),
    });

    await openApp(page);
    await waitForStageMotion(page);
    await page.screenshot({
      path: resolve(outputDirectory, "01-setup-desktop.png"),
    });

    await page.getByRole("button", { name: "About Signal Enhancer" }).click();
    await page
      .getByRole("button", { name: /Explore a prepared review/ })
      .click();
    await page
      .getByRole("heading", { name: "One input under the lens." })
      .waitFor();
    await waitForStageMotion(page);
    await page.screenshot({
      path: resolve(outputDirectory, "02-reveal-desktop.png"),
    });

    await page
      .getByRole("tablist", { name: "Choose one capture to inspect" })
      .getByRole("tab", { name: /Input B/ })
      .click();
    await page.getByText("Viewing Input B only").waitFor();
    await page.screenshot({
      path: resolve(outputDirectory, "02-reveal-input-b-desktop.png"),
    });

    await page.getByRole("button", { name: "Upgrade Input A" }).click();
    await page
      .getByRole("heading", { name: "Reshaping the signal." })
      .waitFor();
    await page
      .locator('.upgrade-stage-rail li[data-state="active"]')
      .filter({ hasText: "Restoring detail" })
      .waitFor();
    await waitForStageMotion(page);
    await page.screenshot({
      path: resolve(outputDirectory, "03-upgrade-progress-desktop.png"),
    });
    await page
      .getByRole("heading", { name: "A local preview, made visible." })
      .waitFor({ timeout: 8_000 });
    await waitForStageMotion(page);
    await page.screenshot({
      path: resolve(outputDirectory, "04-upgrade-result-desktop.png"),
    });
  } finally {
    await browser.close();
  }
}

async function captureMobile() {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({
      viewport: { width: 393, height: 852 },
      deviceScaleFactor: 1,
      isMobile: true,
      hasTouch: true,
    });
    await openLanding(page);
    await waitForLandingMotion(page);
    await page.screenshot({
      path: resolve(outputDirectory, "00-home-mobile.png"),
    });

    await openPreparedReview(page);
    await page.screenshot({
      path: resolve(outputDirectory, "05-reveal-mobile.png"),
    });
    await page.screenshot({
      path: resolve(outputDirectory, "06-reveal-mobile-full.png"),
      fullPage: true,
    });
  } finally {
    await browser.close();
  }
}

async function main() {
  await mkdir(outputDirectory, { recursive: true });
  await captureDesktop();
  await captureMobile();
}

void main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.stack : String(error)}\n`,
  );
  process.exitCode = 1;
});
