/**
 * Where the benchmark's real data lives, and the guard that keeps it out of git.
 *
 * The data is real receipts: names, card tails, addresses. AGENTS.md forbids
 * committing it anywhere, so the directory must exist outside every git
 * repository, and is named by an environment variable rather than guessed.
 */
import fs from "node:fs";
import path from "node:path";

export const DATA_DIR_ENV = "CASHIER_BENCH_DATA_DIR";

/** The nearest ancestor of `directory` (itself included) that holds a `.git`, if any. */
function enclosingGitRoot(directory: string): string | null {
  let current = directory;
  for (;;) {
    if (fs.existsSync(path.join(current, ".git"))) return current;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

/**
 * The resolved data directory. Throws when the variable is unset, the path is
 * relative or missing, or the directory sits inside a git repository.
 */
export function resolveDataDir(env: Record<string, string | undefined> = process.env): string {
  const configured = env[DATA_DIR_ENV];
  if (configured == null || configured.trim() === "") {
    throw new Error(`${DATA_DIR_ENV} is not set: point it at the benchmark data directory`);
  }
  if (!path.isAbsolute(configured)) {
    throw new Error(`${DATA_DIR_ENV} must be an absolute path`);
  }
  if (!fs.existsSync(configured) || !fs.statSync(configured).isDirectory()) {
    throw new Error(`${DATA_DIR_ENV} does not point at an existing directory`);
  }
  const resolved = fs.realpathSync(configured);
  const gitRoot = enclosingGitRoot(resolved);
  if (gitRoot != null) {
    throw new Error(
      `${DATA_DIR_ENV} must be outside every git repository (it is inside ${gitRoot}): ` +
        "real receipts are never committed"
    );
  }
  return resolved;
}
