import type { ChildProcess, SpawnOptions } from "node:child_process";
import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { runVitest } from "../../../scripts/run-vitest";

/** Stands in for `spawn` with a Vitest process that exits at once with `code`. */
function exitingSpawner(code: number) {
  return vi.fn((_command: string, _args: string[], _options: SpawnOptions) => {
    const child = Object.assign(new EventEmitter(), { killed: false, kill: vi.fn() });
    setImmediate(() => child.emit("exit", code, null));
    return child as unknown as ChildProcess;
  });
}

describe("vitest runner", () => {
  it("runs Vitest at UTC with the isolated test environment", async () => {
    const spawnProcess = exitingSpawner(0);

    await expect(
      runVitest({
        args: ["run", "--project=unit-node"],
        environment: {
          NODE_ENV: "development",
          TZ: "America/New_York",
          OPENAI_API_KEY: "real-secret",
        },
        spawnProcess,
      })
    ).resolves.toBe(0);

    const [, args, options] = spawnProcess.mock.calls[0]!;
    expect(args.slice(1)).toEqual(["run", "--project=unit-node"]);
    expect(options.env).toMatchObject({ TZ: "", OPENAI_API_KEY: "test-openai-key" });
  });

  it("takes --time-zone for itself and runs the tests in that zone", async () => {
    const spawnProcess = exitingSpawner(1);

    await expect(
      runVitest({
        args: ["--time-zone=Asia/Singapore", "run", "--project=unit-dom"],
        environment: { NODE_ENV: "development", TZ: "America/New_York" },
        spawnProcess,
      })
    ).resolves.toBe(1);

    const [, args, options] = spawnProcess.mock.calls[0]!;
    expect(args.slice(1)).toEqual(["run", "--project=unit-dom"]);
    expect(options.env).toMatchObject({ TZ: "Asia/Singapore", CASHIER_TEST_TZ: "Asia/Singapore" });
  });

  it("refuses an empty --time-zone instead of falling back to UTC", async () => {
    const spawnProcess = exitingSpawner(0);

    await expect(
      runVitest({
        args: ["--time-zone=", "run"],
        environment: { NODE_ENV: "development" },
        spawnProcess,
      })
    ).rejects.toThrow("--time-zone needs a zone");
    expect(spawnProcess).not.toHaveBeenCalled();
  });
});
