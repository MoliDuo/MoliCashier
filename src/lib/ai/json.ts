/** Pulls the JSON payload out of a model reply and builds the prompt that repairs a bad one. */

/**
 * Clean common JSON formatting issues:
 * - Remove markdown code fences
 * - Trim whitespace
 */
function cleanJsonContent(content: string): string {
  let cleaned = content.trim();

  // Remove markdown code fences
  if (cleaned.startsWith("```json")) {
    cleaned = cleaned.slice(7);
  } else if (cleaned.startsWith("```")) {
    cleaned = cleaned.slice(3);
  }
  if (cleaned.endsWith("```")) {
    cleaned = cleaned.slice(0, -3);
  }

  return cleaned.trim();
}

/**
 * Try to extract JSON from response content
 * Handles: markdown fences, surrounding text, embedded JSON
 */
export function extractJson(content: string): string {
  // First try cleaning markdown fences
  const cleaned = cleanJsonContent(content);
  if (cleaned.startsWith("{") || cleaned.startsWith("[")) {
    return cleaned;
  }

  // Try to find JSON object boundaries
  const jsonStart = content.indexOf("{");
  const jsonEnd = content.lastIndexOf("}");

  if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
    return content.substring(jsonStart, jsonEnd + 1);
  }

  // Try array
  const arrStart = content.indexOf("[");
  const arrEnd = content.lastIndexOf("]");

  if (arrStart !== -1 && arrEnd !== -1 && arrEnd > arrStart) {
    return content.substring(arrStart, arrEnd + 1);
  }

  return cleaned;
}

/**
 * Build the prompt that asks the model to fix its own reply. `problems` says what
 * was wrong (a parse error or schema issue paths, never the offending values).
 */
export function buildRepairPrompt(originalContent: string, problems: readonly string[]): string {
  const hasJson = originalContent.includes("{") || originalContent.includes("[");
  const task = hasJson
    ? "The JSON below was expected to be valid but is not usable. Fix it."
    : "The model was supposed to return a JSON object but returned natural language text. Convert the information in the text into that JSON object.";

  return `You are a JSON repair assistant. ${task}

Rules:
1. Keep every value that is already correct; do not invent data that is not in the content.
2. Fix formatting problems: markdown code blocks, extra text, missing quotes, trailing commas.
3. Fix the problems listed below.
4. Return ONLY the corrected JSON object, no explanations or markdown.

Problems:
${problems.map((problem) => `- ${problem}`).join("\n")}

Content to repair:
${originalContent}

Return the corrected JSON now:`;
}
