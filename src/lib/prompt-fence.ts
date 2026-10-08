/**
 * Text copied from a document or the ledger, fenced off as data inside a prompt. Whoever wrote it
 * may have written something that reads like an instruction, or a closing marker meant to end the
 * fence early, so every closing marker inside the text is escaped and only the real one closes it.
 * Pure: every prompt that hands the model untrusted text fences it here.
 */
export function fenceAsData(tag: string, text: string): string {
  const closingMarker = new RegExp(`<\\s*/\\s*${tag}\\s*>`, "gi");
  return `<${tag}>\n${text.replace(closingMarker, `&lt;/${tag}&gt;`)}\n</${tag}>`;
}
