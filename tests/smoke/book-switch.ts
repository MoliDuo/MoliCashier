import { expect, type Page } from "@playwright/test";

/** 总账, or the nth book in the switcher's order. */
export type BookOption = "all" | number;

/** The top bar's book switcher; its text names the book being viewed. */
export function currentBookOption(page: Page) {
  return page.getByRole("button", { name: /^分账：/ });
}

/** Opens the switcher's menu. A dialog still leaving owns the page, so it waits for that first. */
export async function openBookSwitcher(page: Page) {
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await currentBookOption(page).click();
  await expect(page.getByRole("menu")).toBeVisible();
}

/** The switcher's options, in the order it lists them: 总账 first, then the books. */
export function bookOptions(page: Page) {
  return page.getByRole("menu").getByRole("menuitem");
}

/**
 * Picks an option: 总账 by name, or the nth book by position. Position rather
 * than label, because book names are editable and another test may already
 * have renamed one.
 */
export async function selectBook(page: Page, option: BookOption) {
  await openBookSwitcher(page);
  const options = bookOptions(page);
  if (option === "all") await options.first().click();
  else await options.nth(option + 1).click();
  await expect(page.getByRole("menu")).toHaveCount(0);
}

/**
 * Picks a book by its name. By accessible name, not `hasText`: that comparison
 * ignores case, so a book named Eta would otherwise also find Theta.
 */
export async function selectBookByName(page: Page, name: string) {
  await openBookSwitcher(page);
  await page.getByRole("menu").getByRole("menuitem", { name, exact: true }).click();
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(currentBookOption(page)).toHaveText(name);
}

/** The switcher shows the book's whole name, with no ellipsis cutting it short. */
export async function expectBookNameFits(page: Page) {
  const label = currentBookOption(page).locator("span.truncate");
  await expect.poll(() => label.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
}
