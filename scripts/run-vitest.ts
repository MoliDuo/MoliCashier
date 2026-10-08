import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { TEST_TIME_ZONE_VARIABLE, createTestEnvironment } from "./test-environment";

type SpawnProcess = (command: string, args: string[], options: SpawnOptions) => ChildProcess;

export function signalExitCode(signal: NodeJS.Signals): number {
  return signal === "SIGINT" ? 130 : signal === "SIGTERM" ? 143 : 1;
}

export async function runVitest({
  args = process.argv.slice(2),
  environment = process.env,
  spawnProcess = spawn,
}: {
  args?: string[];
  environment?: NodeJS.ProcessEnv;
  spawnProcess?: SpawnProcess;
} = {}): Promise<number> {
  // `--time-zone=<IANA zone>` is this runner's, not Vitest's: it runs the
  // tests in that zone instead of UTC (see test-environment.ts).
  const timeZoneFlag = "--time-zone=";
  const timeZone = args.find((arg) => arg.startsWith(timeZoneFlag))?.slice(timeZoneFlag.length);
  const vitestArgs = args.filter((arg) => !arg.startsWith(timeZoneFlag));
  if (timeZone === "") throw new Error("--time-zone needs a zone, such as Asia/Singapore");

  if (vitestArgs.includes("--coverage")) {
    mkdirSync(path.resolve("coverage/.tmp"), { recursive: true });
  }

  const vitestCli = path.resolve("node_modules/vitest/vitest.mjs");
  const child = spawnProcess(process.execPath, [vitestCli, ...vitestArgs], {
    env: createTestEnvironment(
      timeZone == null ? environment : { ...environment, [TEST_TIME_ZONE_VARIABLE]: timeZone }
    ),
    stdio: "inherit",
  });
  let requestedSignal: NodeJS.Signals | undefined;

  const forwardSignal = (signal: NodeJS.Signals) => {
    requestedSignal = signal;
    if (!child.killed) child.kill(signal);
  };
  const onSigint = () => forwardSignal("SIGINT");
  const onSigterm = () => forwardSignal("SIGTERM");
  process.on("SIGINT", onSigint);
  process.on("SIGTERM", onSigterm);

  try {
    const result = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
      (resolve, reject) => {
        child.once("error", reject);
        child.once("exit", (code, signal) => resolve({ code, signal }));
      }
    );
    if (requestedSignal) return signalExitCode(requestedSignal);
    return result.signal ? signalExitCode(result.signal) : (result.code ?? 1);
  } finally {
    process.off("SIGINT", onSigint);
    process.off("SIGTERM", onSigterm);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  runVitest()
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
}
