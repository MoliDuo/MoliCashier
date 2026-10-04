import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { documentDir, documentFile } from "../../../../scripts/bench/lib/dataset";
import { buildManifest, verifyAgainstManifest } from "../../../../scripts/bench/lib/manifest";
import { makeDataDir, writeFixtureCase } from "../../../helpers/bench-dataset";

const SUCCESS = {
  outcome: "success" as const,
  entries: [{ itemName: "Lunch", amount: "45.00", currency: "CNY", category: "Food" }],
};

let dataDir: string;

beforeEach(() => {
  dataDir = makeDataDir();
  writeFixtureCase(dataDir, "doc-aaa", { expect: SUCCESS, image: new Uint8Array([1, 2, 3]) });
  writeFixtureCase(dataDir, "doc-bbb", { text: "lunch 45", expect: SUCCESS });
});

describe("benchmark manifest", () => {
  it("lists every document and annotation by hash, and verifies clean data", () => {
    const manifest = buildManifest(dataDir);
    expect(Object.keys(manifest.documents)).toEqual(["doc-aaa", "doc-bbb"]);
    expect(Object.keys(manifest.annotations.parse ?? {})).toEqual(["doc-aaa", "doc-bbb"]);
    expect(verifyAgainstManifest(dataDir, manifest)).toEqual({ errors: [], warnings: [] });
  });

  it("is deterministic", () => {
    expect(buildManifest(dataDir)).toEqual(buildManifest(dataDir));
  });

  it("reports an edited annotation", () => {
    const manifest = buildManifest(dataDir);
    const file = path.join(dataDir, "annotations", "parse", "doc-bbb.json");
    fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace("45.00", "54.00"));
    expect(verifyAgainstManifest(dataDir, manifest).errors).toEqual([
      "annotation parse/doc-bbb: does not match the manifest",
    ]);
  });

  it("reports an edited or missing image, which document.json pins by hash", () => {
    const manifest = buildManifest(dataDir);
    const image = path.join(documentDir(dataDir, "doc-aaa"), "evidence", "1.png");
    fs.writeFileSync(image, new Uint8Array([9, 9, 9]));
    expect(verifyAgainstManifest(dataDir, manifest).errors).toEqual([
      "document doc-aaa: evidence/1.png does not match its recorded hash",
    ]);
    fs.rmSync(image);
    expect(verifyAgainstManifest(dataDir, manifest).errors).toEqual([
      "document doc-aaa: evidence/1.png is missing",
    ]);
  });

  it("reports an edited document.json", () => {
    const manifest = buildManifest(dataDir);
    const file = documentFile(dataDir, "doc-bbb");
    fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace("lunch 45", "lunch 46"));
    expect(verifyAgainstManifest(dataDir, manifest).errors).toEqual([
      "document doc-bbb: document.json does not match the manifest",
    ]);
  });

  it("warns about a case the manifest does not know, and errors on one it lost", () => {
    const manifest = buildManifest(dataDir);
    writeFixtureCase(dataDir, "doc-ccc", { text: "new", expect: SUCCESS });
    const added = verifyAgainstManifest(dataDir, manifest);
    expect(added.errors).toEqual([]);
    expect(added.warnings).toEqual([
      "document doc-ccc: not in the manifest",
      "annotation parse/doc-ccc: not in the manifest",
    ]);

    fs.rmSync(documentDir(dataDir, "doc-bbb"), { recursive: true });
    fs.rmSync(path.join(dataDir, "annotations", "parse", "doc-bbb.json"));
    expect(verifyAgainstManifest(dataDir, manifest).errors).toEqual([
      "document doc-bbb: listed in the manifest but missing",
      "annotation parse/doc-bbb: listed in the manifest but missing",
    ]);
  });

  it("checks only the requested cases when given a scope", () => {
    const manifest = buildManifest(dataDir);
    fs.rmSync(documentDir(dataDir, "doc-bbb"), { recursive: true });
    const report = verifyAgainstManifest(dataDir, manifest, {
      documentIds: ["doc-aaa"],
      annotations: [{ task: "parse", id: "doc-aaa" }],
    });
    expect(report).toEqual({ errors: [], warnings: [] });
  });
});
