const fs = require("node:fs");
const path = require("node:path");

/** A `@/x` directory or single-file module, as a resolved path. */
const moduleAt = (prefix) => `^${prefix}(?:/|\\.[^/.]+$)`;
/** An npm package, resolved into node_modules (or its @types) or left unresolved. */
const packages = (names) => [
  `(?:^|/)node_modules/(?:@types/)?(?:${names})/`,
  `^(?:${names})(?:/|$)`,
];

const persistence = moduleAt("src/persistence");
const libDb = moduleAt("src/lib/db");
const s3 = moduleAt("src/lib/storage/s3");
const aiRuntime = moduleAt("src/lib/ai/(?:client|structured)");
/** src/lib/ai except the plain data shapes that domain code shares with it. */
const aiCode = "^src/lib/ai/(?!types\\.[^/.]+$)";
const logger = moduleAt("src/lib/logger");
const serverFlows = moduleAt("src/server");
const moduleServer = moduleAt("src/modules/[^/]+/server");
const moduleUi = moduleAt("src/modules/[^/]+/(?:ui|hooks)");
const moduleServerActions = moduleAt("src/modules/[^/]+/server-actions");
const app = moduleAt("src/app");
const providerSdks = packages("pg|openai|drizzle-orm|@aws-sdk/[^/]+");
const frameworks = packages("next|server-only");
const uiFrameworks = packages("react|react-dom");
const aiSdks = packages("ai|openai|@(?:ai-sdk|aws-sdk|google|anthropic-ai)/[^/]+");
const openAiSdk = packages("openai");
const awsSdks = packages("@aws-sdk/[^/]+");
const dataAccess = [libDb, persistence, ...providerSdks];
const actionsFile = "actions(?:\\.[^/.]+|/index\\.[^/.]+)$";
const actionsBarrel = `(?:^|/)${actionsFile}`;
const moduleActionsBarrel = `^src/modules/[^/]+/${actionsFile}`;

/** Whether the module prologue opens with `"use client"` after comments. */
function hasClientDirective(source) {
  const prologue = source.replace(/^(?:\s+|\/\/[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/)*/, "");
  return /^(?:"use client"|'use client')/.test(prologue);
}

function sourceFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(absolute);
    return /\.(?:tsx?|mts|mjs)$/.test(entry.name) ? [absolute] : [];
  });
}

const onto = (paths) => ({ path: paths });

const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/**
 * Client code: module UI and hooks, the shared components and hooks, by where they live, plus any
 * other file that opens with `"use client"` (client components under `src/app`).
 */
const clientCode = [
  "^src/modules/[^/]+/(?:ui|hooks)/",
  "^src/components/",
  "^src/hooks/",
  ...sourceFiles(path.join(__dirname, "src"))
    .filter((file) => hasClientDirective(fs.readFileSync(file, "utf8")))
    .map((file) => `^${escape(path.relative(__dirname, file).split(path.sep).join("/"))}$`),
];

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "no-import-cycles",
      comment: "Modules and src/server may call each other only without file-level import cycles.",
      severity: "error",
      from: { path: "^src/" },
      to: { circular: true },
    },
    {
      name: "modules-not-app",
      comment: "Modules must not import app entrypoints.",
      severity: "error",
      from: { path: "^src/modules/" },
      to: onto(app),
    },
    {
      name: "lib-not-feature-code",
      comment: "src/lib must not import modules, app, or src/server.",
      severity: "error",
      from: { path: "^src/lib/" },
      to: onto([moduleAt("src/modules"), app, serverFlows]),
    },
    {
      name: "persistence-not-feature-code",
      comment: "Persistence must not import modules or src/server.",
      severity: "error",
      from: { path: "^src/persistence/" },
      to: onto([moduleAt("src/modules"), serverFlows]),
    },
    {
      name: "copy-is-a-leaf",
      comment: "src/copy holds plain copy; it may only read types from src/config.",
      severity: "error",
      from: { path: "^src/copy/" },
      to: { pathNot: ["^src/copy/", "^src/config/"] },
    },
    {
      name: "modules-not-workspace",
      comment: "Domain modules must not depend on workspace orchestration.",
      severity: "error",
      from: { path: "^src/modules/", pathNot: "^src/modules/workspace/" },
      to: onto(moduleAt("src/modules/workspace")),
    },
    {
      name: "domain-stays-pure",
      comment:
        "Domain code has no database, providers, AI runtime, logger, frameworks, or server code.",
      severity: "error",
      from: { path: "^src/modules/[^/]+/domain/" },
      to: onto([
        ...dataAccess,
        ...frameworks,
        ...uiFrameworks,
        aiCode,
        logger,
        serverFlows,
        moduleServer,
      ]),
    },
    {
      name: "domain-no-node-builtins",
      comment: "Domain code does no IO: node builtins (crypto, timers, fs) belong in server code.",
      severity: "error",
      from: { path: "^src/modules/[^/]+/domain/" },
      to: { dependencyTypes: ["core"] },
    },
    {
      name: "openai-only-in-lib-ai",
      comment: "Only src/lib/ai talks to the AI provider SDK.",
      severity: "error",
      from: { pathNot: "^src/lib/ai/" },
      to: onto(openAiSdk),
    },
    {
      name: "aws-sdk-only-in-lib-storage",
      comment: "Only src/lib/storage talks to the object-storage SDK.",
      severity: "error",
      from: { pathNot: "^src/lib/storage/" },
      to: onto(awsSdks),
    },
    {
      name: "server-flows-not-entrypoints",
      comment: "src/server must not import app entrypoints, server actions, or UI.",
      severity: "error",
      from: { path: "^src/server/" },
      to: onto([app, moduleServerActions, moduleUi]),
    },
    {
      name: "entrypoints-call-server-functions",
      comment:
        "Server actions and API routes call server functions, not the database or providers.",
      severity: "error",
      from: { path: ["^src/modules/[^/]+/server-actions/", "^src/app/api/"] },
      to: onto([...dataAccess, s3, aiRuntime, ...aiSdks]),
    },
    {
      name: "providers-not-module-ui",
      comment: "src/components/providers must not import module UI.",
      severity: "error",
      from: { path: "^src/components/providers/" },
      to: onto(moduleUi),
    },
    {
      name: "client-not-server-code",
      comment:
        'Client code (UI, hooks, components, "use client" files) must not import server code.',
      severity: "error",
      from: { path: clientCode },
      to: onto([libDb, persistence, serverFlows, moduleServer, s3, aiRuntime]),
    },
    {
      name: "client-not-actions-barrel",
      comment: "Client code imports concrete server actions, not an actions barrel.",
      severity: "error",
      from: { path: clientCode },
      to: onto(actionsBarrel),
    },
    {
      name: "api-routes-not-server-actions",
      comment: "API routes must not import module server actions or actions barrels.",
      severity: "error",
      from: { path: "^src/app/api/" },
      to: onto([moduleServerActions, moduleActionsBarrel]),
    },
  ],
  options: {
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.json" },
    doNotFollow: { path: "node_modules" },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default", "types"],
      mainFields: ["module", "main", "types", "typings"],
    },
  },
};
