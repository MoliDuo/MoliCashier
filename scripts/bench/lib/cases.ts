/** Selecting and loading the cases of one task. */
import { listAnnotationIds, loadAnnotation, loadDocument, loadEvidenceImages } from "./dataset";
import type { BenchCase } from "./runner";
import type { BenchTask } from "../tasks/types";

export interface CaseSelection {
  /** `gold` by default; `all` includes candidates and cases marked needs-fix. */
  status: "gold" | "all";
  /** Keep only cases labelled with this rule. */
  rule?: string;
  /** Keep only cases whose document id contains this text. */
  idContains?: string;
  limit?: number;
}

export interface LoadedCases {
  cases: BenchCase[];
  /** Annotation problems that make a case unrunnable; the run refuses to start with any. */
  problems: string[];
}

export async function loadCases(
  dataDir: string,
  task: BenchTask,
  selection: CaseSelection
): Promise<LoadedCases> {
  const cases: BenchCase[] = [];
  const problems: string[] = [];

  for (const id of listAnnotationIds(dataDir, task.name)) {
    if (selection.idContains != null && !id.includes(selection.idContains)) continue;
    const annotation = loadAnnotation(dataDir, task.name, id, task.expectSchema);
    if (selection.status === "gold" && annotation.labels.status !== "gold") continue;
    if (selection.rule != null && !annotation.labels.rules.includes(selection.rule)) continue;

    const document = loadDocument(dataDir, id);
    const found = task.check(document, annotation.expect);
    if (found.length > 0) {
      problems.push(...found.map((problem) => `${task.name}/${id}: ${problem}`));
      continue;
    }
    cases.push({
      document,
      images: await loadEvidenceImages(dataDir, document),
      labels: annotation.labels,
      expect: annotation.expect,
    });
    if (selection.limit != null && cases.length >= selection.limit) break;
  }
  return { cases, problems };
}
