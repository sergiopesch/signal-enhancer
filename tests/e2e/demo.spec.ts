import { expect, test } from "@playwright/test";

test("prepared comparison completes the honest browser-only journey", async ({
  page,
}) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: "Listen to the chain." }),
  ).toBeVisible();
  await expect(
    page.getByText("stays on this device until you upgrade"),
  ).toBeVisible();

  await page.getByRole("button", { name: "About" }).click();
  await expect(
    page.getByRole("dialog", { name: "Capture isn’t neutral." }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: /Explore a prepared comparison/ })
    .click();

  await expect(
    page.getByRole("heading", { name: "Same sound. Different ears." }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Loudness matched" }).click();
  await page.getByRole("button", { name: "Spectrum" }).click();
  await expect(
    page.getByRole("img", { name: /Loudness-matched spectrum comparison/ }),
  ).toBeVisible();

  await page
    .getByRole("button", { name: /Upgrade Signal/ })
    .first()
    .click();
  await expect(
    page.getByRole("heading", { name: "Reshaping the signal." }),
  ).toBeVisible();
  await expect(
    page.getByText("No audio leaves this browser in demo mode."),
  ).toBeVisible();

  await expect(
    page.getByRole("heading", { name: "A local preview, made visible." }),
  ).toBeVisible({ timeout: 8_000 });
  await expect(
    page.getByText("no AI model was used", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: /Download preview WAV/ }),
  ).toHaveAttribute("download", "signal-enhancer-input-a.wav");
});
