import { expect, test, type Locator, type Page } from "@playwright/test";
import { openTab, showListControls } from "./navigation";
import { seedRecord } from "./seed-record";
import { signIn } from "./sign-in";

/**
 * What used to be checked by hand on a phone: Esc inside an inline editor,
 * fields large enough that iOS Safari does not zoom in on them, and the
 * category editor in 设置. The `iphone` project runs this file in WebKit.
 */

/**
 * The text fields on screen whose font is under 16px. iOS Safari zooms the
 * page into such a field when it takes focus, and does not zoom back out.
 * Fields a reader cannot type into (hidden, disabled, checkboxes, the hidden
 * <select> behind a custom one) are left out.
 */
async function fieldsThatZoom(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const untyped = new Set([
      "hidden",
      "file",
      "checkbox",
      "radio",
      "range",
      "color",
      "button",
      "submit",
      "reset",
      "image",
    ]);
    const fields = document.querySelectorAll<
      HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
    >("input, textarea, select");
    return [...fields]
      .filter(
        (field) =>
          !(field instanceof HTMLInputElement && untyped.has(field.type)) &&
          !field.disabled &&
          field.closest("[aria-hidden='true'], [inert]") == null &&
          field.checkVisibility({ visibilityProperty: true, opacityProperty: true }) &&
          field.getBoundingClientRect().width > 1
      )
      .map((field) => ({
        name:
          field.getAttribute("aria-label") ??
          field.getAttribute("name") ??
          field.getAttribute("placeholder") ??
          field.outerHTML.slice(0, 80),
        size: Number.parseFloat(getComputedStyle(field).fontSize),
      }))
      .filter(({ size }) => size < 16)
      .map(({ name, size }) => `${name} (${size}px)`);
  });
}

function detailSheet(page: Page) {
  return page.getByRole("dialog").first();
}

/** An entry's row in the sheet, after the title; picking it makes its fields editable. */
function entryRow(sheet: Locator, item: string) {
  return sheet.getByText(item, { exact: true }).last();
}

async function openRecord(page: Page, item: string) {
  const card = page.getByTestId("source-document-card-root").filter({ hasText: item });
  await card.getByRole("button", { name: item, exact: true }).click();
  await expect(page).toHaveURL(/detail=/);
  await expect(detailSheet(page)).toBeVisible();
}

test("Esc cancels an inline edit and leaves the record open", async ({
  page,
  isMobile,
}, testInfo) => {
  const item = `Escape ${testInfo.project.name}`;
  await signIn(page);
  await seedRecord(page, { item, amount: "12.34" });
  await openRecord(page, item);
  const sheet = detailSheet(page);

  // The title.
  await sheet.getByRole("button", { name: item, exact: true }).first().click();
  const title = sheet.getByRole("textbox", { name: "账单标题", exact: true });
  await expect(title).toBeFocused();
  if (isMobile) expect(await fieldsThatZoom(page)).toEqual([]);
  await title.fill(`${item} not kept`);
  await title.press("Escape");
  await expect(title).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await expect(page).toHaveURL(/detail=/);
  await expect(sheet.getByRole("button", { name: item, exact: true }).first()).toBeVisible();

  // The amount, which edits through the calculator input once its row is picked.
  await entryRow(sheet, item).click();
  await sheet.getByRole("button", { name: "金额", exact: true }).click();
  const amount = sheet.getByRole("textbox", { name: "金额", exact: true });
  await expect(amount).toBeFocused();
  if (isMobile) expect(await fieldsThatZoom(page)).toEqual([]);
  await amount.fill("99.99");
  await amount.press("Escape");
  await expect(amount).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await expect(sheet.getByRole("button", { name: "金额", exact: true })).toHaveText("12.34");

  // Nothing was written: the record reads back as it was.
  await page.reload();
  await expect(entryRow(detailSheet(page), item)).toBeVisible();
  await expect(detailSheet(page)).toContainText("12.34");
  await expect(detailSheet(page)).not.toContainText("99.99");
  await expect(
    detailSheet(page).getByRole("button", { name: item, exact: true }).first()
  ).toBeVisible();
  await expect(page.getByText(`${item} not kept`)).toHaveCount(0);

  // With no edit open, Esc is the sheet's again and closes it.
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page).not.toHaveURL(/detail=/);
});

test("a phone's text fields are at least 16px, so Safari does not zoom", async ({
  page,
  isMobile,
}, testInfo) => {
  test.skip(!isMobile, "phone widths only");
  const item = `Zoom ${testInfo.project.name}`;
  await signIn(page);
  await seedRecord(page, { item, amount: "8.00" });

  // 账目.
  await expect(page.getByTestId("source-document-card-root").first()).toBeVisible();
  expect(await fieldsThatZoom(page)).toEqual([]);

  // The new-record form.
  await page.getByRole("button", { name: "记账", exact: true }).click();
  const form = page.getByRole("dialog");
  await expect(form.getByRole("textbox", { name: /收支内容/ })).toBeVisible();
  expect(await fieldsThatZoom(page)).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // A record's detail sheet, with an entry's name open for editing.
  await openRecord(page, item);
  const sheet = detailSheet(page);
  await entryRow(sheet, item).click();
  await sheet.getByRole("button", { name: item, exact: true }).last().click();
  await expect(sheet.locator("input:focus, textarea:focus")).toHaveCount(1);
  expect(await fieldsThatZoom(page)).toEqual([]);
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // 账目's list controls, which a phone drops down over the list.
  await showListControls(page);
  expect(await fieldsThatZoom(page)).toEqual([]);

  // 设置, with the category editor open.
  await openTab(page, "设置");
  await expect(page.getByRole("textbox", { name: "账本提示词", exact: true })).toBeVisible();
  expect(await fieldsThatZoom(page)).toEqual([]);
  await page.getByRole("button", { name: "管理分类", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "新分类名称", exact: true })).toBeVisible();
  expect(await fieldsThatZoom(page)).toEqual([]);
  await page.getByRole("button", { name: "编辑分类 Food", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("textbox", { name: "分类名称" })).toBeVisible();
  expect(await fieldsThatZoom(page)).toEqual([]);
});

test("categories are added, renamed and deleted in 设置", async ({ page }, testInfo) => {
  // Every project runs against the same ledger, and the other specs count on
  // its seeded categories, so this one only touches a category it adds.
  const name = `Cat ${testInfo.project.name}`;
  const renamed = `Cat2 ${testInfo.project.name}`;
  const section = page.locator("section").filter({ has: page.getByTestId("uncategorized-row") });
  const manage = section.getByRole("button", { name: "管理分类", exact: true });
  const save = async () => {
    await section.getByRole("button", { name: "保存", exact: true }).click();
    // Saving leaves the editor.
    await expect(manage).toBeVisible();
  };
  const category = (label: string) => section.getByText(label, { exact: true });

  await signIn(page);
  await openTab(page, "设置");

  await manage.click();
  await section.getByRole("textbox", { name: "新分类名称", exact: true }).fill(name);
  await section.getByRole("button", { name: "添加", exact: true }).click();
  await expect(category(name)).toBeVisible();
  await save();
  await expect(category(name)).toBeVisible();

  await manage.click();
  await section.getByRole("button", { name: `编辑分类 ${name}`, exact: true }).click();
  const editor = page.getByRole("dialog");
  await editor.getByRole("textbox", { name: "分类名称", exact: true }).fill(renamed);
  await editor.getByRole("button", { name: "保存", exact: true }).click();
  await expect(editor).toHaveCount(0);
  await save();
  await page.reload();
  await expect(category(renamed)).toBeVisible();
  await expect(category(name)).toHaveCount(0);

  await manage.click();
  await section.getByRole("button", { name: `${renamed}的更多操作`, exact: true }).click();
  await page.getByRole("menuitem", { name: "删除", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "确认", exact: true }).click();
  await expect(category(renamed)).toHaveCount(0);
  await save();
  await page.reload();
  await expect(section.getByText("Food", { exact: true })).toBeVisible();
  await expect(category(renamed)).toHaveCount(0);
});
