import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import { pathToFileURL } from "node:url";
import { signalExitCode } from "./run-vitest";

type SpawnProcess = (command: string, args: string[], options: SpawnOptions) => ChildProcess;

interface TaskResult {
  script: string;
  exitCode: number;
  durationMs: number;
}

/**
 * The gate, as stages of npm scripts. A stage's scripts run side by side and
 * the next stage starts only when every one of them passed, so a formatting
 * or type error fails in seconds instead of after the test suite. The build
 * waits for `tsc` because both write `.next/types`. Beside the coverage run,
 * the unit suite runs again at Asia/Singapore, so date code that only holds
 * at UTC fails here rather than in a reader's evening.
 */
export const CHECK_STAGES: readonly (readonly string[])[] = [
  ["format:check", "check:architecture", "check:dead-code", "lint", "tsc"],
  ["test:coverage", "test:unit:sg", "build:check"],
];

function formatSeconds(durationMs: number): string {
  return `${(durationMs / 1000).toFixed(1)}s`;
}

export function formatSummary(results: TaskResult[], totalMs: number): string {
  const width = Math.max(...results.map(({ script }) => script.length));
  const rows = results.map(
    ({ script, exitCode, durationMs }) =>
      `  ${exitCode === 0 ? "✓" : "✗"} ${script.padEnd(width)}  ${formatSeconds(durationMs).padStart(7)}`
  );
  return ["", "check summary", ...rows, `  total ${formatSeconds(totalMs)}`, ""].join("\n");
}

export async function runCheck({
  stages = CHECK_STAGES,
  environment = process.env,
  spawnProcess = spawn,
  write = (text: string) => void process.stdout.write(text),
  now = () => performance.now(),
}: {
  stages?: readonly (readonly string[])[];
  environment?: NodeJS.ProcessEnv;
  spawnProcess?: SpawnProcess;
  write?: (text: string) => void;
  now?: () => number;
} = {}): Promise<number> {
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  // Output is buffered per script, so keep the colours a terminal would get.
  const env = process.stdout.isTTY ? { FORCE_COLOR: "1", ...environment } : environment;
  const running = new Set<ChildProcess>();
  const results: TaskResult[] = [];
  let requestedSignal: NodeJS.Signals | undefined;

  const forwardSignal = (signal: NodeJS.Signals) => {
    requestedSignal = signal;
    for (const child of running) if (!child.killed) child.kill(signal);
  };
  const onSigint = () => forwardSignal("SIGINT");
  const onSigterm = () => forwardSignal("SIGTERM");
  process.on("SIGINT", onSigint);
  process.on("SIGTERM", onSigterm);

  const runScript = (script: string): Promise<TaskResult> => {
    const startedAt = now();
    const child = spawnProcess(npm, ["run", "--silent", script], {
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    running.add(child);
    const output: Buffer[] = [];
    child.stdout?.on("data", (chunk: Buffer) => output.push(chunk));
    child.stderr?.on("data", (chunk: Buffer) => output.push(chunk));

    return new Promise((resolve) => {
      let finished = false;
      // A script that fails to start can report both `error` and `close`.
      const finish = (exitCode: number) => {
        if (finished) return;
        finished = true;
        running.delete(child);
        const result = { script, exitCode, durationMs: now() - startedAt };
        const status = exitCode === 0 ? "passed" : `failed (exit ${exitCode})`;
        write(`\n── ${script} ${status} in ${formatSeconds(result.durationMs)}\n`);
        write(Buffer.concat(output).toString());
        resolve(result);
      };
      child.once("error", (error) => {
        output.push(Buffer.from(`${error.message}\n`));
        finish(1);
      });
      // `close` rather than `exit`: it waits for the last of the script's output.
      child.once("close", (code: number | null, signal: NodeJS.Signals | null) =>
        finish(signal ? signalExitCode(signal) : (code ?? 1))
      );
    });
  };

  const startedAt = now();
  try {
    for (const stage of stages) {
      write(`\n▶ ${stage.join(", ")}\n`);
      const stageResults = await Promise.all(stage.map(runScript));
      results.push(...stageResults);
      if (requestedSignal || stageResults.some(({ exitCode }) => exitCode !== 0)) break;
    }
  } finally {
    process.off("SIGINT", onSigint);
    process.off("SIGTERM", onSigterm);
  }

  write(formatSummary(results, now() - startedAt));
  if (requestedSignal) return signalExitCode(requestedSignal);
  return results.find(({ exitCode }) => exitCode !== 0)?.exitCode ?? 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  runCheck()
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
}
