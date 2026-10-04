import path from "path";
import { fileURLToPath } from "node:url";
import { defineConfig, defineProject } from "vitest/config";

const configDirectory = path.dirname(fileURLToPath(import.meta.url));

const resolveAliases = {
  "@": path.resolve(configDirectory, "src"),
  tests: path.resolve(configDirectory, "tests"),
  "server-only": path.resolve(configDirectory, "tests/stubs/server-only.ts"),
};

const coverageConfig = {
  provider: "v8" as const,
  reporter: ["text", "json", "html"],
  reportsDirectory: "./coverage",
  // The coverage runner creates reportsDirectory/.tmp before Vitest starts.
  clean: false,
  include: ["src/**/*.ts", "src/**/*.tsx"],
  /**
   * Module UI used to be excluded, although 59 test files cover it: the
   * thresholds neither credited those tests nor noticed an untested component.
   * Including it moved every figure up rather than down, so the exclusion was
   * only hiding work that was already being done. The numbers below sit a few
   * points under the measured ones, which is room for ordinary movement and
   * not room for a feature to arrive untested.
   */
  thresholds: {
    lines: 76,
    statements: 74,
    functions: 73,
    branches: 66,
  },
  exclude: [
    "node_modules",
    ".next",
    "tests",
    "src/**/*.test.ts",
    "src/**/*.test.tsx",
    "src/app/**/page.tsx",
    "src/app/**/layout.tsx",
    "src/app/**/loading.tsx",
    "src/app/**/error.tsx",
    "src/app/**/not-found.tsx",
    "src/app/manifest.ts",
  ],
};

const defaultProjectExcludes = ["node_modules", ".next"];
const unitDomTypeScriptTests = [
  "tests/unit/lib/ai/client.test.ts",
  "tests/unit/lib/drafts.test.ts",
  "tests/unit/lib/image-utils.test.ts",
  "tests/unit/lib/navigation/ledger-detail-navigation.test.ts",
  "tests/unit/lib/navigation/ledger-new-record-navigation.test.ts",
  "tests/unit/lib/sign-out-cleanup.test.ts",
  "tests/unit/lib/store/modal-stack.test.ts",
  "tests/unit/lib/utils.test.ts",
  "tests/unit/modules/currency/hooks/useConvertedAmount.test.ts",
  "tests/unit/modules/source-document/hooks/source-document-input-images.test.ts",
  "tests/unit/modules/source-document/hooks/source-document-submission-upload.test.ts",
  "tests/unit/modules/workspace/ledger-url-navigation.test.ts",
  "tests/unit/modules/workspace/ledger-url-params.test.ts",
  "tests/unit/modules/workspace/pull-reveal.test.ts",
  "tests/unit/modules/workspace/tab-swipe.test.ts",
  "tests/unit/modules/workspace/ui/new-record-success-feedback.test.ts",
];
const sharedProjectTestConfig = {
  globals: true,
  env: {
    NODE_ENV: "test" as const,
  },
  pool: "threads" as const,
  fileParallelism: true,
  isolate: true,
  // Database-backed workers create a schema and apply the full migration journal.
  hookTimeout: 60_000,
};
/**
 * Projects in one `sequence.groupOrder` run side by side and must share a
 * worker limit. The unit and integration projects share one, so the unit
 * files fill the cores while the test PostgreSQL container starts and no
 * project waits for another's slowest file.
 */
const parallelProjects = {
  sequence: { groupOrder: 0 },
  maxWorkers: "100%",
};

export default defineConfig({
  resolve: {
    alias: resolveAliases,
  },
  test: {
    coverage: coverageConfig,
    projects: [
      defineProject({
        resolve: { alias: resolveAliases },
        test: {
          ...sharedProjectTestConfig,
          name: "unit-node",
          ...parallelProjects,
          include: ["tests/unit/**/*.test.ts"],
          exclude: [...defaultProjectExcludes, ...unitDomTypeScriptTests],
          environment: "node",
          setupFiles: ["./tests/setup.common.ts"],
          testTimeout: 10000,
        },
      }),
      defineProject({
        resolve: { alias: resolveAliases },
        test: {
          ...sharedProjectTestConfig,
          name: "unit-dom",
          ...parallelProjects,
          include: ["tests/unit/**/*.test.tsx", ...unitDomTypeScriptTests],
          exclude: defaultProjectExcludes,
          environment: "happy-dom",
          setupFiles: ["./tests/setup.dom.ts"],
          testTimeout: 10000,
        },
      }),
      defineProject({
        resolve: { alias: resolveAliases },
        test: {
          ...sharedProjectTestConfig,
          name: "integration-node",
          ...parallelProjects,
          include: ["tests/integration/**/*.test.ts", "tests/integration/**/*.test.tsx"],
          exclude: [
            ...defaultProjectExcludes,
            "tests/integration/modules/source-document/ui/source-document-dialog-flows.test.tsx",
          ],
          environment: "node",
          globalSetup: ["./tests/setup.postgres-global.ts"],
          setupFiles: ["./tests/setup.ts"],
          pool: "forks",
          testTimeout: 30000,
        },
      }),
      defineProject({
        resolve: { alias: resolveAliases },
        test: {
          ...sharedProjectTestConfig,
          name: "integration-dom",
          sequence: { groupOrder: 1 },
          include: [
            "tests/integration/modules/source-document/ui/source-document-dialog-flows.test.tsx",
          ],
          exclude: defaultProjectExcludes,
          environment: "happy-dom",
          setupFiles: ["./tests/setup.dom.ts"],
          maxWorkers: 1,
          testTimeout: 30000,
        },
      }),
    ],
  },
});
