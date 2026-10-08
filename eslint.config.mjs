import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

/** Every file allowed to insert, update or delete `sourceDocuments` rows. */
export const registeredSourceDocumentWriters = [
  "src/modules/source-document/server/delete.ts",
  "src/modules/source-document/server/updates.ts",
  "src/modules/source-document/server/split.ts",
  "src/modules/source-document/server/cancel-processing.ts",
  "src/modules/source-document/server/date-organization.ts",
  "src/modules/source-document/server/duplicate-suggestion.ts",
  "src/modules/source-document/server/projections/manual-entries.ts",
  "src/modules/source-document/server/projections/writes.ts",
  "src/modules/source-document/server/extraction-attempts.ts",
  "src/modules/source-document/server/document-input.ts",
];

const identifierKey = "/^(?:userId|documentId|sourceDocumentId|attemptId|fileId|storedFileId)$/";
const logCall =
  "CallExpression[callee.type='MemberExpression'][callee.computed=false]:matches(" +
  "[callee.object.name='logger'][callee.property.name=/^(?:debug|info|warn|error|fatal)$/], " +
  "[callee.object.name='console'][callee.property.name=/^(?:debug|info|warn|error)$/])";
const loggedIdentifier = `${logCall} > ObjectExpression > Property[kind='init'][method=false][computed=false]:matches([key.name=${identifierKey}], [key.value=${identifierKey}])`;
const logIdentifierCall = "[value.type='CallExpression'][value.callee.name='logIdentifier']";
const importsLogIdentifier =
  "ImportDeclaration[source.value='@/lib/security/log-identifier'] > ImportSpecifier[imported.name='logIdentifier'][local.name='logIdentifier']";
const identifierMessage =
  "logger/console must wrap identifier properties in logIdentifier (from @/lib/security/log-identifier) or omit them.";

// Pino's methods read their logger from `this`; a detached one throws once
// logging is on, which it is in production but not in tests.
const detachedLogMethod =
  "MemberExpression[object.name='logger'][computed=false][property.name=/^(?:trace|debug|info|warn|error|fatal)$/]:not(CallExpression > MemberExpression.callee)";

const arbitraryTextSize = "/(?<![\\w-])text-\\[\\d+(?:\\.\\d+)?(?:px|rem|em)\\]/";
const mutedAlias = "/(?<![\\w-])text-muted(?![-\\w])/";
const textSizeMessage =
  "Text sizes come from the frozen scale in globals.css, not text-[…] values.";
const mutedMessage = "Use text-muted-foreground rather than the duplicate text-muted token.";

// Feature code takes its prose sizes from the roles in `@/components/typography`;
// only the primitives and the role table itself spell the sizes out. A variant
// prefix (`sm:text-xs`) is still a raw size; a longer token (`text-xsomething`) is not.
const rawTextSize = "/(?<![\\w-])text-(?:xs|sm|base|lg)(?![-\\w])/";
const rawTextSizeMessage =
  "Use a role from @/components/typography (textRoleClassName) instead of a raw text-xs/sm/base/lg size.";
const rawTextSizeSyntax = [
  { selector: `Literal[value=${rawTextSize}]`, message: rawTextSizeMessage },
  { selector: `TemplateElement[value.cooked=${rawTextSize}]`, message: rawTextSizeMessage },
];

const architectureSyntax = [
  { selector: `${loggedIdentifier}:not(${logIdentifierCall})`, message: identifierMessage },
  {
    selector: `Program:not(:has(${importsLogIdentifier})) ${loggedIdentifier}${logIdentifierCall}`,
    message: identifierMessage,
  },
  {
    selector: detachedLogMethod,
    message: "Call logger methods directly; a detached pino method loses its logger.",
  },
  { selector: `Literal[value=${arbitraryTextSize}]`, message: textSizeMessage },
  { selector: `TemplateElement[value.cooked=${arbitraryTextSize}]`, message: textSizeMessage },
  { selector: `Literal[value=${mutedAlias}]`, message: mutedMessage },
  { selector: `TemplateElement[value.cooked=${mutedAlias}]`, message: mutedMessage },
];
const sourceDocumentWriteMessage =
  "sourceDocuments writes must live in a registered source-document writer (registeredSourceDocumentWriters in eslint.config.mjs).";
/** Raw SQL that writes the table by name: `UPDATE source_documents`, `INSERT INTO …`, `DELETE FROM …`. */
const rawSourceDocumentWrite =
  '/\\b(?:UPDATE|INSERT\\s+INTO|DELETE\\s+FROM)\\s+(?:ONLY\\s+)?"?source_documents"?(?![\\w"])/i';
const sourceDocumentWrites = [
  {
    selector:
      "CallExpression[callee.type='MemberExpression'][callee.computed=false][callee.property.name=/^(?:insert|update|delete)$/] > Identifier[name='sourceDocuments']",
    message: sourceDocumentWriteMessage,
  },
  {
    selector: `TemplateElement[value.raw=${rawSourceDocumentWrite}]`,
    message: sourceDocumentWriteMessage,
  },
  { selector: `Literal[value=${rawSourceDocumentWrite}]`, message: sourceDocumentWriteMessage },
];

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    ".next/**",
    ".next-cashier-*/**",
    ".next-smoke/**",
    ".worktrees/**",
    ".claude/**",
    ".tmp/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "coverage/**",
    "playwright-report/**",
    "test-results/**",
    "public/sw.js",
  ]),
  {
    files: ["**/*.ts", "**/*.tsx"],
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
          ignoreRestSiblings: true,
        },
      ],
    },
  },
  {
    files: ["**/*.cjs"],
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
  {
    files: ["src/**/*.{ts,tsx,mts,mjs}"],
    rules: {
      "no-restricted-syntax": ["error", ...architectureSyntax, ...sourceDocumentWrites],
    },
  },
  {
    files: ["src/modules/**/ui/**/*.{ts,tsx}", "src/app/**/*.{ts,tsx}", "src/components/*.tsx"],
    // The amount table is the second class table beside the role table; it
    // keeps its own sizes so retuning a prose role cannot move an amount.
    ignores: [
      "src/components/ui/**",
      "src/components/skeletons/**",
      "src/components/typography.ts",
      "src/modules/currency/ui/amount-text.tsx",
    ],
    rules: {
      "no-restricted-syntax": [
        "error",
        ...architectureSyntax,
        ...sourceDocumentWrites,
        ...rawTextSizeSyntax,
      ],
    },
  },
  {
    files: [...registeredSourceDocumentWriters, "src/persistence/postgres-migrations/**"],
    rules: {
      "no-restricted-syntax": ["error", ...architectureSyntax],
    },
  },
  {
    // Server code runs in one long-lived process: a promise nobody awaits fails silently, or after
    // the work it should have finished. These two rules need type information, so they are scoped
    // to the server side, where a dropped await does that damage.
    files: [
      "src/server/**/*.ts",
      "src/modules/*/server/**/*.ts",
      "src/modules/*/server-actions/**/*.ts",
      "src/lib/**/*.ts",
      "src/app/api/**/*.ts",
      "src/instrumentation.ts",
    ],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
    },
  },
]);
