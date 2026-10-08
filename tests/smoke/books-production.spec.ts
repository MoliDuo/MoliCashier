import { expect, test, type Page } from "@playwright/test";
import { currentBookOption, selectBook, selectBookByName } from "./book-switch";
import { bookAction, bookMenu, bookRow } from "./book-rows";
import { ledgerNavigation, openTab } from "./navigation";
import { pageErrors } from "./page-errors";
import { seedRecord } from "./seed-record";
import { signIn } from "./sign-in";

/**
 * The multi-book flows the production runner can actually exercise: a signed-in
 * session, the two seeded books (共同支出 and 旅行支出), the settings tab
 * driven from a second, independent browser context, and a real upload through
 * the public API v1 with a book-bound service credential.
 *
 * Every project of this file runs against the same database, so nothing here
 * touches the seeded books and everything it creates it also retires. A book
 * that ever held a record can only be archived — a hard delete refuses it — so
 * those are left archived, while the empty ones are deleted outright.
 */

/** The title the AI stub gives every bill it parses. */
const PARSED_TITLE = "Demo Receipt";

/** A 1x1 PNG: the smallest image the upload path accepts. */
const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

function apiBase(): string {
  const base = process.env.SMOKE_BASE_URL;
  if (base == null || base === "") throw new Error("SMOKE_BASE_URL is not set");
  return base;
}

async function login(page: Page) {
  await signIn(page);
  await expect(page.getByRole("button", { name: "记账", exact: true })).toBeEnabled();
}

/** The 分账 row that names `name`, matched exactly so one book cannot shadow another. */
async function addBook(page: Page, name: string) {
  await page.getByRole("button", { name: "新增分账", exact: true }).click();
  const dialog = page.getByRole("dialog").last();
  await dialog.getByLabel("名称", { exact: true }).fill(name);
  await dialog.getByRole("button", { name: "新增分账", exact: true }).click();
  await expect(bookRow(page, name)).toBeVisible();
}

async function deleteBook(page: Page, name: string) {
  await bookAction(page, name, "删除");
  await page.getByRole("dialog").last().getByRole("button", { name: "删除", exact: true }).click();
  await expect(bookRow(page, name)).toHaveCount(0);
}

/**
 * Retires a book through the confirmation. Used where the book already holds a
 * record, which is the case a hard delete refuses and the case the demo
 * workspace's own tests are not allowed to produce.
 */
async function archiveBook(page: Page, name: string) {
  await bookAction(page, name, "归档");
  await page.getByRole("dialog").last().getByRole("button", { name: "归档", exact: true }).click();
  await expect(bookRow(page, name).getByRole("button", { name: "恢复" })).toBeVisible();
}

/** Files one record into `book` and waits for the list to show it. */
async function recordInBook(
  page: Page,
  { item, amount, book }: { item: string; amount: string; book: string }
) {
  await seedRecord(page, { item, amount, book });
  await expect(page.getByText(item, { exact: true }).first()).toBeVisible();
}

/** The stream's total for the settled period, read off its own toolbar. */
function streamTotal(page: Page) {
  return page.getByTestId("entries-toolbar").first();
}

function statsHero(page: Page) {
  return page.getByText("总支出", { exact: true }).locator("..");
}

/** A second browser, with its own cookies: the device state must not travel. */
async function newDevice(page: Page) {
  const context = await page.context().browser()!.newContext();
  const other = await context.newPage();
  await login(other);
  return { context, page: other };
}

test("books production creates, renames and reorders a book, and keeps it across a reload", async ({
  page,
}, testInfo) => {
  const errors = pageErrors(page);
  const suffix = testInfo.project.name;
  const firstName = `Alpha ${suffix}`;
  const secondName = `Beta ${suffix}`;
  const renamed = `Beta2 ${suffix}`;

  /** The watched rows, in the order the list actually paints them. */
  const order = async (names: [string, string]) => {
    const texts = await page.getByRole("listitem").allTextContents();
    return names
      .map((name) => ({ name, at: texts.findIndex((text) => text.includes(name)) }))
      .filter((row) => row.at >= 0)
      .sort((left, right) => left.at - right.at)
      .map((row) => row.name);
  };

  await login(page);
  await openTab(page, "设置");
  await addBook(page, firstName);
  await addBook(page, secondName);
  await expect.poll(() => order([firstName, secondName])).toEqual([firstName, secondName]);

  // A name is one field of a book that already exists, so the row opens in place
  // and Enter writes it — nothing covers the list to rename it.
  await bookRow(page, secondName)
    .getByRole("button", { name: `重命名 ${secondName}`, exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const nameInput = page.getByRole("textbox", { name: `重命名 ${secondName}`, exact: true });
  await nameInput.fill(renamed);
  await nameInput.press("Enter");
  await expect(bookRow(page, renamed)).toBeVisible();
  await expect(bookRow(page, secondName)).toHaveCount(0);

  // One step up, not to the top: the seeded books keep the positions every
  // other test in this runner depends on.
  await bookAction(page, renamed, "上移");
  // 分账 is written from the action's answer, so the swap lands a round trip after
  // the click; the painted order is the state to wait on.
  await expect.poll(() => order([firstName, renamed])).toEqual([renamed, firstName]);
  await expect(bookMenu(page, renamed)).toBeEnabled();

  await page.reload();
  await expect(bookRow(page, renamed)).toBeVisible();
  await expect.poll(() => order([firstName, renamed])).toEqual([renamed, firstName]);

  await deleteBook(page, renamed);
  await deleteBook(page, firstName);
  expect(errors).toEqual([]);
});

test("books production scopes the stream, the details and the stats to one book", async ({
  page,
}, testInfo) => {
  const errors = pageErrors(page);
  const suffix = testInfo.project.name;
  const bookA = `Gamma ${suffix}`;
  const bookB = `Delta ${suffix}`;
  const itemA = `Gamma item ${suffix}`;
  const itemB = `Delta item ${suffix}`;

  await login(page);
  await openTab(page, "设置");
  await addBook(page, bookA);
  await addBook(page, bookB);
  await openTab(page, "账目");

  await recordInBook(page, { item: itemA, amount: "111.11", book: bookA });
  await recordInBook(page, { item: itemB, amount: "222.22", book: bookB });

  // 总账 is every book at once.
  await expect(page.getByText(itemA, { exact: true }).first()).toBeVisible();
  await expect(page.getByText(itemB, { exact: true }).first()).toBeVisible();

  await selectBookByName(page, bookA);
  await expect(page.getByText(itemA, { exact: true }).first()).toBeVisible();
  await expect(page.getByText(itemB, { exact: true })).toHaveCount(0);
  await expect(streamTotal(page)).toContainText("¥111.11");

  await selectBookByName(page, bookB);
  await expect(page.getByText(itemB, { exact: true }).first()).toBeVisible();
  await expect(page.getByText(itemA, { exact: true })).toHaveCount(0);
  await expect(streamTotal(page)).toContainText("¥222.22");

  // 明细 follows the same scope, and the same scope carries across tabs.
  await openTab(page, "明细");
  await expect(page.getByTestId("ledger-entry-card-root").filter({ hasText: itemB })).toHaveCount(
    1
  );
  await expect(page.getByTestId("ledger-entry-card-root").filter({ hasText: itemA })).toHaveCount(
    0
  );
  await selectBook(page, "all");
  await expect(page.getByTestId("ledger-entry-card-root").filter({ hasText: itemA })).toHaveCount(
    1
  );
  await expect(page.getByTestId("ledger-entry-card-root").filter({ hasText: itemB })).toHaveCount(
    1
  );

  await selectBookByName(page, bookA);
  await openTab(page, "统计");
  // The hero is the scope's own total, so a wrong scope cannot pass by summing
  // the books to the same number.
  await expect(statsHero(page).getByText("¥111.11", { exact: true })).toBeVisible();

  await selectBookByName(page, bookB);
  await expect(statsHero(page).getByText("¥222.22", { exact: true })).toBeVisible();

  await openTab(page, "设置");
  await archiveBook(page, bookA);
  await archiveBook(page, bookB);
  expect(errors).toEqual([]);
});

test("books production moves a record from one book to another", async ({ page }, testInfo) => {
  const errors = pageErrors(page);
  const suffix = testInfo.project.name;
  const bookA = `Epsilon ${suffix}`;
  const bookB = `Zeta ${suffix}`;
  const item = `Moved item ${suffix}`;

  await login(page);
  await openTab(page, "设置");
  await addBook(page, bookA);
  await addBook(page, bookB);
  await openTab(page, "账目");
  await recordInBook(page, { item, amount: "333.33", book: bookA });

  await selectBookByName(page, bookA);
  await expect(streamTotal(page)).toContainText("¥333.33");

  // The record's own page owns the move; the book that gets it is the one that
  // then counts it, in the book view and in the total.
  await page
    .getByTestId("source-document-card-root")
    .filter({ hasText: item })
    .getByRole("button", { name: item, exact: true })
    .click();
  const detail = page.getByRole("dialog").first();
  const detailBook = detail.getByLabel("分账", { exact: true });
  await expect(detailBook).toContainText(bookA);
  await detailBook.press("ArrowDown");
  await page.getByRole("option", { name: bookB, exact: true }).click();
  await expect(detailBook).toContainText(bookB);
  await detail.getByRole("button", { name: "关闭", exact: true }).click();

  await expect(page.getByText(item, { exact: true })).toHaveCount(0);
  await selectBookByName(page, bookB);
  await expect(page.getByText(item, { exact: true }).first()).toBeVisible();
  await expect(streamTotal(page)).toContainText("¥333.33");

  await selectBookByName(page, bookA);
  await expect(streamTotal(page)).toContainText("¥0.00");
  await openTab(page, "统计");
  await expect(statsHero(page).getByText("¥0.00", { exact: true })).toBeVisible();
  await selectBookByName(page, bookB);
  await expect(statsHero(page).getByText("¥333.33", { exact: true })).toBeVisible();

  await openTab(page, "设置");
  await archiveBook(page, bookA);
  await archiveBook(page, bookB);
  expect(errors).toEqual([]);
});

test("books production starts a record in the viewed book", async ({ page }, testInfo) => {
  const errors = pageErrors(page);
  const suffix = testInfo.project.name;
  const bookA = `Eta ${suffix}`;
  const bookB = `Theta ${suffix}`;
  const text = `Picker item ${suffix}`;

  await login(page);
  await openTab(page, "设置");
  await addBook(page, bookA);
  await addBook(page, bookB);
  await openTab(page, "账目");
  await selectBookByName(page, bookA);

  // Viewing a book, 记账 starts in that book.
  await page.getByRole("button", { name: "记账", exact: true }).click();
  let dialog = page.getByRole("dialog").last();
  await expect(dialog.getByLabel("分账", { exact: true })).toContainText(bookA);

  await dialog.getByLabel("分账", { exact: true }).press("ArrowDown");
  await page.getByRole("option", { name: bookB, exact: true }).click();
  await dialog.getByRole("textbox", { name: /收支内容/ }).fill(text);
  await dialog.getByRole("button", { name: "发送", exact: true }).click();
  await expect(
    page.getByText(`已保存到「${bookB}」，当前视图不会显示这张账单。`, { exact: true })
  ).toBeVisible();

  // Saving elsewhere did not move the view, and the next record still starts
  // in the book being viewed.
  await expect(currentBookOption(page)).toHaveText(bookA);
  await expect(page.getByText(PARSED_TITLE, { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "记账", exact: true }).click();
  dialog = page.getByRole("dialog").last();
  await expect(dialog.getByLabel("分账", { exact: true })).toContainText(bookA);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);

  // The stub's bill shows up in the book it was filed into once it is parsed.
  await selectBookByName(page, bookB);
  await expect(page.getByText(PARSED_TITLE, { exact: true }).first()).toBeVisible({
    timeout: 30_000,
  });

  await openTab(page, "设置");
  await archiveBook(page, bookA);
  await archiveBook(page, bookB);
  expect(errors).toEqual([]);
});

test("books production keeps the viewed book per browser, not per account", async ({ page }) => {
  const errors = pageErrors(page);

  await login(page);
  await expect(currentBookOption(page)).toHaveText("总账");
  await selectBookByName(page, "旅行支出");

  await page.reload();
  await expect(currentBookOption(page)).toHaveText("旅行支出");

  // Another browser signs in as the same account and still opens on 总账.
  const other = await newDevice(page);
  try {
    await expect(currentBookOption(other.page)).toHaveText("总账");
    await selectBookByName(other.page, "共同支出");
    await page.reload();
    await expect(currentBookOption(page)).toHaveText("旅行支出");
  } finally {
    await other.context.close();
  }
  expect(errors).toEqual([]);
});

test("books production sees a book archived by another browser when 设置 opens", async ({
  page,
}, testInfo) => {
  const errors = pageErrors(page);
  const bookName = `Iota ${testInfo.project.name}`;

  await login(page);
  const other = await newDevice(page);
  try {
    await openTab(other.page, "设置");
    await addBook(other.page, bookName);
    await archiveBook(other.page, bookName);

    // This browser has not read 分账 yet, so this first visit is what has to
    // carry the archived row — the workspace bootstrap only knows live books.
    await openTab(page, "设置");
    await expect(page.getByRole("heading", { name: "已归档的分账", exact: true })).toBeVisible();
    await expect(bookRow(page, bookName).getByText("已归档", { exact: true })).toBeVisible();
    await bookRow(page, bookName).getByRole("button", { name: "恢复", exact: true }).click();
    await expect(bookMenu(page, bookName)).toBeVisible();
    await deleteBook(page, bookName);
  } finally {
    await other.context.close();
  }
  expect(errors).toEqual([]);
});

test("books production picks up another browser's change when 设置 comes back into view", async ({
  page,
}, testInfo) => {
  const errors = pageErrors(page);
  const bookName = `Kappa ${testInfo.project.name}`;

  await login(page);
  await openTab(page, "设置");
  await expect(bookRow(page, "共同支出")).toBeVisible();

  const other = await newDevice(page);
  try {
    await openTab(other.page, "设置");
    await addBook(other.page, bookName);

    // Coming back to this browser is what brings the other browser's book in:
    // the ledger's sync version moved, so every query on 设置 reads again.
    await expect(bookRow(page, bookName)).toHaveCount(0);
    await page.evaluate(() => window.dispatchEvent(new Event("visibilitychange")));
    await expect(bookRow(page, bookName)).toBeVisible();
    await deleteBook(page, bookName);
    await expect(bookRow(other.page, bookName)).toHaveCount(1);
  } finally {
    await other.context.close();
  }
  expect(errors).toEqual([]);
});

test("books production falls back to 总账 when the viewed book is archived", async ({
  page,
}, testInfo) => {
  const errors = pageErrors(page);
  const bookName = `Lambda ${testInfo.project.name}`;

  await login(page);
  await openTab(page, "设置");
  await addBook(page, bookName);
  await openTab(page, "账目");
  await selectBookByName(page, bookName);

  await openTab(page, "设置");
  await archiveBook(page, bookName);
  await openTab(page, "账目");
  // The dead scope is gone once the strip marks 总账 again.
  await expect(currentBookOption(page)).toHaveText("总账");

  await openTab(page, "设置");
  await bookRow(page, bookName).getByRole("button", { name: "恢复", exact: true }).click();
  await expect(bookMenu(page, bookName)).toBeVisible();
  await deleteBook(page, bookName);
  expect(errors).toEqual([]);
});

test("books production files an API upload into the book its key is bound to", async ({
  page,
}, testInfo) => {
  const errors = pageErrors(page);
  const suffix = testInfo.project.name;
  const bookName = `Mu ${suffix}`;
  const credentialName = `Uploader ${suffix}`;

  await login(page);
  await openTab(page, "设置");
  await addBook(page, bookName);

  await page.getByRole("button", { name: "新建 API 密钥", exact: true }).click();
  const createDialog = page.getByRole("dialog").last();
  await createDialog
    .getByLabel("密钥名称（例如：自动记账脚本）", { exact: true })
    .fill(credentialName);
  await createDialog.getByLabel("分账", { exact: true }).press("ArrowDown");
  await page.getByRole("option", { name: bookName, exact: true }).click();
  await createDialog.getByRole("button", { name: "确认", exact: true }).click();

  const tokenDialog = page.getByRole("dialog").last();
  const tokenMatch = (await tokenDialog.locator("div.break-all").innerText()).match(
    /sk_live_[0-9a-f]{64}/
  );
  const token = tokenMatch?.[0];
  expect(token).toMatch(/^sk_live_[0-9a-f]{64}$/);
  await tokenDialog.getByRole("button", { name: "我已保存", exact: true }).click();
  await expect(
    page.getByRole("combobox", { name: `修改「${credentialName}」的分账`, exact: true })
  ).toHaveText(bookName);

  const headers = { Authorization: `Bearer ${token!}` };
  const created = await page.request.post(`${apiBase()}/api/v1/source-documents`, {
    headers,
    data: { images: [{ data: PNG_BASE64, mimeType: "image/png" }] },
  });
  expect(created.status()).toBe(201);
  const createdBody = (await created.json()) as { sourceDocumentId?: string };
  const sourceDocumentId = createdBody.sourceDocumentId;
  expect(sourceDocumentId).toMatch(/^[0-9a-f-]{36}$/);

  // The stub provider answers in seconds; polling the status is the observable
  // state, so nothing here waits on a fixed clock.
  await expect
    .poll(
      async () => {
        const response = await page.request.get(
          `${apiBase()}/api/v1/source-documents/${sourceDocumentId}`,
          { headers }
        );
        const body = (await response.json()) as { status?: string };
        return body.status ?? `http-${response.status()}`;
      },
      { timeout: 60_000, intervals: [1_000, 2_000] }
    )
    .toBe("completed");

  await openTab(page, "账目");
  await selectBookByName(page, bookName);
  // A neutral click away from the switcher, on the tab already shown.
  await ledgerNavigation(page).getByRole("button", { name: "账目", exact: true }).click();
  await expect(
    page.getByTestId("source-document-card-root").filter({ hasText: "Demo Receipt" })
  ).toHaveCount(1);
  await expect(streamTotal(page)).toContainText("¥12.34");

  // Take the record back out — through its own detail page — so the key can be
  // deleted and the book retired without leaning on a hard delete it refuses.
  await page
    .getByTestId("source-document-card-root")
    .filter({ hasText: "Demo Receipt" })
    .getByRole("button", { name: "Demo Receipt", exact: true })
    .click();
  const detail = page.getByRole("dialog").first();
  await detail.getByRole("button", { name: "更多操作" }).click();
  await page.getByRole("menuitem", { name: "删除账单", exact: true }).click();
  await page.getByRole("dialog").last().getByRole("button", { name: "删除", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await openTab(page, "设置");
  await page.getByRole("button", { name: `删除${credentialName}`, exact: true }).click();
  await page.getByRole("dialog").last().getByRole("button", { name: "删除", exact: true }).click();
  await expect(page.getByRole("button", { name: `删除${credentialName}` })).toHaveCount(0);
  await archiveBook(page, bookName);
  expect(errors).toEqual([]);
});
