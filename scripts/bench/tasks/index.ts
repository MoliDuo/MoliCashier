import type { BenchTask } from "./types";

/**
 * Tasks load on demand: importing one pulls in the production module it
 * calls, and with it the logger, which reads its level when first imported —
 * so the runner sets its environment before the first task loads.
 */
const TASK_LOADERS: Record<string, () => Promise<BenchTask>> = {
  parse: async () => (await import("./parse/task")).parseTask,
};

export const TASK_NAMES = Object.keys(TASK_LOADERS);

export async function loadTask(name: string): Promise<BenchTask> {
  const loader = TASK_LOADERS[name];
  if (loader == null) {
    throw new Error(`unknown task "${name}"; known tasks: ${TASK_NAMES.join(", ")}`);
  }
  return loader();
}
