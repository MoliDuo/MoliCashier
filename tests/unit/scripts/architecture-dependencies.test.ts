import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { cruise, type IConfiguration, type IViolation } from "dependency-cruiser";
import extractTSConfig from "dependency-cruiser/config-utl/extract-ts-config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const repositoryRoot = process.cwd();
const config = createRequire(import.meta.url)(
  path.join(repositoryRoot, ".dependency-cruiser.cjs")
) as Required<Pick<IConfiguration, "forbidden" | "options">>;

/**
 * One deliberate violation per rule, plus allowed imports that must stay
 * quiet. The tree lives under .tmp so node_modules still resolves the way it
 * does for src.
 */
const fixture: Record<string, string> = {
  // Without a baseUrl, the paths plugin would resolve `@/` against the working directory.
  "tsconfig.json": JSON.stringify({
    compilerOptions: { baseUrl: ".", paths: { "@/*": ["./src/*"] } },
  }),
  "src/app/page.tsx": "export default function Page() { return null; }\n",
  "src/lib/db/index.ts": "export const db = {};\n",
  "src/lib/cycle-a.ts": 'import type { B } from "./cycle-b";\nexport interface A { b?: B }\n',
  "src/lib/cycle-b.ts": 'import type { A } from "./cycle-a";\nexport interface B { a?: A }\n',
  "src/lib/uses-module.ts": 'export { model } from "@/modules/demo/model";\n',
  "src/persistence/schema.ts": 'import "@/server/flow";\n',
  "src/persistence/typed.ts": 'export type Model = import("@/modules/demo/model").Model;\n',
  "src/server/flow.ts": "export const flow = 1;\n",
  "src/server/flow-ui.ts": 'import "@/modules/demo/ui/panel";\n',
  "src/modules/workspace/store.ts": "export const store = 1;\n",
  "src/modules/demo/model.ts": "export type Model = { id: string };\nexport const model = 1;\n",
  "src/modules/demo/widget.ts": 'import Page from "@/app/page";\nexport { Page };\n',
  "src/modules/demo/uses-workspace.ts":
    'import { store } from "@/modules/workspace/store";\nexport { store };\n',
  "src/modules/demo/domain/rule.ts":
    'import type { SQL } from "drizzle-orm";\nexport type Rule = SQL;\n',
  "src/modules/demo/server/store.ts": 'import { db } from "@/lib/db";\nexport { db };\n',
  "src/modules/demo/server-actions/save.ts": 'import { db } from "@/lib/db";\nexport { db };\n',
  "src/modules/demo/actions.ts": 'export * from "./server-actions/save";\n',
  "src/modules/demo/hooks/use-thing.ts": "export function useThing() {}\n",
  "src/modules/demo/ui/panel.tsx":
    '"use client";\nimport { flow } from "@/server/flow";\nexport { flow };\n',
  "src/modules/demo/ui/form.tsx":
    '"use client";\nimport { db } from "../actions";\nexport { db };\n',
  "src/components/providers/root.tsx":
    'import { useThing } from "@/modules/demo/hooks/use-thing";\nexport { useThing };\n',
  "src/app/api/save/route.ts":
    'import { db } from "@/modules/demo/server-actions/save";\nexport { db };\n',
  "src/app/api/ok/route.ts": 'import { db } from "@/modules/demo/server/store";\nexport { db };\n',
};

let fixtureRoot: string;
let violations: IViolation[];

beforeAll(async () => {
  mkdirSync(path.join(repositoryRoot, ".tmp"), { recursive: true });
  fixtureRoot = mkdtempSync(path.join(repositoryRoot, ".tmp", "architecture-"));
  for (const [file, source] of Object.entries(fixture)) {
    mkdirSync(path.dirname(path.join(fixtureRoot, file)), { recursive: true });
    writeFileSync(path.join(fixtureRoot, file), source);
  }
  // The real rule lists "use client" files found under the repository's src.
  const forbidden = config.forbidden.map((rule) =>
    rule.name?.startsWith("client-") ? { ...rule, from: { path: "^src/modules/demo/ui/" } } : rule
  );
  const tsConfigFile = path.join(fixtureRoot, "tsconfig.json");
  const result = await cruise(
    ["src"],
    {
      ...config.options,
      baseDir: fixtureRoot,
      tsConfig: { fileName: tsConfigFile },
      validate: true,
      ruleSet: { forbidden },
    },
    {},
    { tsConfig: extractTSConfig(tsConfigFile) }
  );
  if (typeof result.output === "string") throw new Error("expected a cruise result");
  violations = result.output.summary.violations;
}, 30_000);

afterAll(() => {
  if (fixtureRoot != null) rmSync(fixtureRoot, { recursive: true, force: true });
});

describe("dependency-cruiser architecture rules", () => {
  it("reports each forbidden import under the rule that names it", () => {
    const found = violations.map((violation) => `${violation.rule.name} ${violation.from}`).sort();

    expect(found).toEqual(
      [
        "no-import-cycles src/lib/cycle-a.ts",
        "modules-not-app src/modules/demo/widget.ts",
        "lib-not-feature-code src/lib/uses-module.ts",
        "persistence-not-feature-code src/persistence/schema.ts",
        "persistence-not-feature-code src/persistence/typed.ts",
        "modules-not-workspace src/modules/demo/uses-workspace.ts",
        "domain-stays-pure src/modules/demo/domain/rule.ts",
        "server-flows-not-entrypoints src/server/flow-ui.ts",
        "entrypoints-call-server-functions src/modules/demo/server-actions/save.ts",
        "providers-not-module-ui src/components/providers/root.tsx",
        "client-not-server-code src/modules/demo/ui/panel.tsx",
        "client-not-actions-barrel src/modules/demo/ui/form.tsx",
        "api-routes-not-server-actions src/app/api/save/route.ts",
      ].sort()
    );
  });

  it("counts a cycle made only of type imports", () => {
    const cycle = violations.find((violation) => violation.rule.name === "no-import-cycles");

    expect(cycle?.cycle?.map((step) => step.name)).toEqual([
      "src/lib/cycle-b.ts",
      "src/lib/cycle-a.ts",
    ]);
  });

  it("resolves packages through node_modules, so a type-only import still counts", () => {
    const domain = violations.find((violation) => violation.rule.name === "domain-stays-pure");

    expect(domain?.to).toMatch(/(?:^|\/)node_modules\/drizzle-orm\//);
  });

  it("lists the repository's own client components, and only those", () => {
    const clientRule = config.forbidden.find((rule) => rule.name === "client-not-server-code");
    const clientPaths = [clientRule?.from.path ?? []].flat();

    expect(clientPaths).toContain("^src/modules/ledger/ui/CategoryAssignmentTasks\\.tsx$");
    expect(clientPaths).not.toContain("^src/app/layout\\.tsx$");
  });
});
