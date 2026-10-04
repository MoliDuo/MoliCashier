import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DATA_DIR_ENV, resolveDataDir } from "../../../../scripts/bench/lib/data-dir";
import { makeDataDir } from "../../../helpers/bench-dataset";

describe("benchmark data directory", () => {
  it("resolves an existing directory outside git", () => {
    const dir = makeDataDir();
    expect(resolveDataDir({ [DATA_DIR_ENV]: dir })).toBe(fs.realpathSync(dir));
  });

  it("requires the variable, an absolute path and an existing directory", () => {
    expect(() => resolveDataDir({})).toThrow(/is not set/);
    expect(() => resolveDataDir({ [DATA_DIR_ENV]: "relative/dir" })).toThrow(/absolute/);
    expect(() =>
      resolveDataDir({ [DATA_DIR_ENV]: path.join(os.tmpdir(), "no-such-bench-dir") })
    ).toThrow(/existing directory/);
  });

  it("refuses a directory inside a git repository, however deep", () => {
    const repo = makeDataDir();
    fs.mkdirSync(path.join(repo, ".git"));
    const nested = path.join(repo, "data", "bench");
    fs.mkdirSync(nested, { recursive: true });
    expect(() => resolveDataDir({ [DATA_DIR_ENV]: nested })).toThrow(
      /outside every git repository/
    );
  });

  it("follows symlinks, so a link out of a repository does not hide it", () => {
    const repo = makeDataDir();
    fs.mkdirSync(path.join(repo, ".git"));
    const target = path.join(repo, "private");
    fs.mkdirSync(target);
    const link = path.join(makeDataDir(), "link");
    fs.symlinkSync(target, link);
    expect(() => resolveDataDir({ [DATA_DIR_ENV]: link })).toThrow(/outside every git repository/);
  });
});
