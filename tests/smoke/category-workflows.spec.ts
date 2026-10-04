import { expect, test } from "@playwright/test";
import { ledgerNavigation, openTab } from "./navigation";
import { seedRecord } from "./seed-record";
import { signIn } from "./sign-in";

test("AI category assignment reports its outcome and fits narrow screens", async ({
  page,
  isMobile,
}, testInfo) => {
  const isShortMobile = testInfo.project.name === "short-mobile";
  if (isMobile && !isShortMobile) await page.setViewportSize({ width: 390, height: 844 });
  const item = `Category workflow ${testInfo.project.name}`;

  await signIn(page);

  await seedRecord(page, { item, amount: "12.34" });

  await openTab(page, "明细");
  await expect(page).toHaveURL(/\/entries/);
  // The bill list leaves the page when the entry list commits, not when the URL changes.
  await expect(page.getByText(item, { exact: true })).toHaveCount(1);
  await expect(page.getByText(item, { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "选择", exact: true }).click();
  await page.getByRole("checkbox", { name: `选择${item}`, exact: true }).click();
  await page.getByRole("button", { name: /^(设置分类|分类)$/ }).click();

  const categoryDialog = page.getByRole("dialog");
  await expect(categoryDialog.getByRole("heading", { name: "设置分类" })).toBeVisible();
  const candidates = categoryDialog.getByRole("checkbox");
  await candidates.nth(1).click();
  await candidates.nth(2).click();
  const confirm = categoryDialog.getByRole("button", { name: "AI 分类 1 条明细" });

  if (isShortMobile) {
    await page.locator("html").evaluate((element) => {
      element.style.fontSize = "125%";
    });
    await expect(confirm).toBeVisible();
    const box = await confirm.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.y + box!.height).toBeLessThanOrEqual(568);
  }

  await confirm.click();
  await expect(categoryDialog).toHaveCount(0);

  // The entry itself says it is being worked on, the way a document being processed does.
  await expect(page.getByTestId("category-assignment-entry-label")).toHaveText("分类中");

  // The run reports through the same toasts as everything else, not a band of its own,
  // and the entry carries no mark of the run once it is over.
  await expect(page.getByText(/已更新 1 条，0 条无需改动/)).toBeVisible({ timeout: 20_000 });
  await expect(page.locator("#category-assignment-status")).toHaveCount(0);
  await expect(page.getByTestId("category-assignment-entry-label")).toHaveCount(0);

  // The list stays in selecting after an action; a phone's tab bar comes back
  // once the reader leaves it.
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await expect(ledgerNavigation(page)).toBeVisible();
});
