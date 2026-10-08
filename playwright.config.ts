import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/smoke",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: process.env.SMOKE_BASE_URL,
    // The smoke run serves HTTPS with a certificate it made for itself.
    ignoreHTTPSErrors: true,
    locale: "zh-CN",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    actionTimeout: 15_000,
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
    {
      name: "short-mobile",
      testMatch: /category-workflows\.spec\.ts/,
      use: {
        ...devices["Pixel 7"],
        viewport: { width: 320, height: 568 },
      },
    },
    // Safari on an iPhone is what the two readers carry, and WebKit differs from
    // the Chromium phone above in what the hand checks used to catch: zooming
    // into small fields, Esc in an inline editor, the settings sheets. So it
    // runs the specs written for those, not the whole suite twice. Motion is
    // reduced because Playwright's Linux WebKit crashes the page now and then
    // when a click lands on a menu item while the menu is still animating in;
    // with the animations cut short, 150 such clicks in a row went through.
    {
      name: "iphone",
      testMatch: /(mobile-editing|books-production)\.spec\.ts/,
      use: { ...devices["iPhone 15"], reducedMotion: "reduce" },
    },
  ],
});
