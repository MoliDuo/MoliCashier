/** The key a book's forecast, or every book's together, is judged and scored under. */
export function forecastScope(bookId: string | undefined): string {
  return bookId ?? "all";
}
