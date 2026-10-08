import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "../../..");

// A migration or query that leans on a newer major passes every test and then fails on deploy,
// so the test container must run the same major as every compose file.
const files = [
  "scripts/prepare-test-postgres.ts",
  "deploy/docker-compose.yml",
  "compose.yaml",
  "docker-compose.local.yml",
  "docker-compose.demo.yml",
];

function postgresMajors(file: string): string[] {
  const text = readFileSync(path.join(root, file), "utf8");
  return [...text.matchAll(/postgres:(\d+)-alpine/g)].map((match) => match[1]!);
}

describe("PostgreSQL major version", () => {
  it("is the same in the test container and every compose file", () => {
    const majors = new Map(files.map((file) => [file, postgresMajors(file)]));
    for (const [file, found] of majors) {
      expect(found, file).not.toHaveLength(0);
    }
    expect(new Set([...majors.values()].flat()).size).toBe(1);
  });
});
