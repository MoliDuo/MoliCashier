import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * A server action that meets a signed-out session has to send the browser to
 * sign in: in production a thrown action error reaches the page only as a
 * generic message. Every exported action is therefore built by one of the
 * wrappers that do that. The `/api/ledger-queries` route keeps the plain
 * `withLedgerAccess`, which throws and becomes a 401.
 */
const ACTION_WRAPPERS = new Set(["withLedgerAction", "withSourceDocumentLedgerAccess"]);

/** Actions that run before there is a session to require. */
const SIGNED_OUT_ACTIONS = new Set(["src/modules/auth/server-actions/sign-in.ts"]);

const root = path.resolve(__dirname, "../../..");

function serverActionFiles(): string[] {
  const modules = path.join(root, "src/modules");
  return readdirSync(modules).flatMap((moduleName) => {
    const directory = path.join(modules, moduleName, "server-actions");
    let names: string[];
    try {
      names = readdirSync(directory);
    } catch {
      return [];
    }
    return names
      .filter((name) => name.endsWith(".ts"))
      .map((name) => path.relative(root, path.join(directory, name)));
  });
}

function parse(file: string): ts.SourceFile {
  return ts.createSourceFile(
    file,
    readFileSync(path.join(root, file), "utf8"),
    ts.ScriptTarget.Latest,
    true
  );
}

function isUseServer(source: ts.SourceFile): boolean {
  const first = source.statements[0];
  return (
    first != null &&
    ts.isExpressionStatement(first) &&
    ts.isStringLiteral(first.expression) &&
    first.expression.text === "use server"
  );
}

function isExported(node: ts.Node): boolean {
  return (
    ts.canHaveModifiers(node) &&
    (ts.getModifiers(node) ?? []).some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)
  );
}

/** Each exported action and the wrapper that builds it, or null when it is not wrapped. */
function exportedActions(source: ts.SourceFile): { name: string; wrapper: string | null }[] {
  const actions: { name: string; wrapper: string | null }[] = [];
  for (const statement of source.statements) {
    if (!isExported(statement)) continue;
    if (ts.isFunctionDeclaration(statement)) {
      actions.push({ name: statement.name?.text ?? "default", wrapper: null });
    } else if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        const initializer = declaration.initializer;
        const wrapper =
          initializer != null &&
          ts.isCallExpression(initializer) &&
          ts.isIdentifier(initializer.expression)
            ? initializer.expression.text
            : null;
        actions.push({ name: declaration.name.getText(source), wrapper });
      }
    }
  }
  return actions;
}

describe("server actions", () => {
  const files = serverActionFiles().filter((file) => isUseServer(parse(file)));

  it("are found", () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it.each(files.filter((file) => !SIGNED_OUT_ACTIONS.has(file)))(
    "%s sends a signed-out session to sign in",
    (file) => {
      const actions = exportedActions(parse(file));
      expect(actions.length).toBeGreaterThan(0);
      for (const action of actions) {
        expect(
          { action: action.name, wrapper: action.wrapper },
          `${action.name} must be built with withLedgerAction or withSourceDocumentLedgerAccess`
        ).toEqual({ action: action.name, wrapper: expect.toSatisfy(isActionWrapper) });
      }
    }
  );

  it("keep the source-document wrapper on the sign-in redirect", () => {
    const source = parse("src/modules/source-document/server-actions/access.ts");
    expect(source.getText()).toMatch(/\bredirectSignedOut\(/);
  });
});

function isActionWrapper(wrapper: unknown): boolean {
  return typeof wrapper === "string" && ACTION_WRAPPERS.has(wrapper);
}
