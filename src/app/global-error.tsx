"use client";
import "./globals.css";
import { useEffect } from "react";
import { textRoleClassName } from "@/components/typography";
import { errorCopy, metadataCopy } from "@/copy/app";

/**
 * The root layout itself failed, so this page brings its own document. It keeps
 * to plain elements: nothing it shows may depend on what just broke. Retrying
 * reloads the page, which also picks up a deploy that replaced the scripts.
 */
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="zh-CN">
      <body data-app="cashier" className="antialiased" style={{ backgroundColor: "var(--bg)" }}>
        <title>{`${errorCopy.title} · ${metadataCopy.title}`}</title>
        <main
          id="main-content"
          className="flex min-h-dvh items-center justify-center bg-bg p-4 text-text"
        >
          <div className="w-full max-w-md space-y-4 rounded-lg border border-border bg-surface p-8 text-center">
            <h1 className={textRoleClassName("pageTitle")}>{errorCopy.title}</h1>
            <p className={textRoleClassName("bodyMuted")}>{errorCopy.description}</p>
            {error.digest != null ? (
              <p className={textRoleClassName("meta", "rounded bg-surface2 p-2 font-mono")}>
                {errorCopy.errorId({ id: error.digest })}
              </p>
            ) : null}
            <button
              type="button"
              onClick={() => window.location.reload()}
              className={textRoleClassName(
                "bodyStrong",
                "inline-flex min-h-11 w-full items-center justify-center rounded-md bg-primary px-4 text-white hover:bg-primary/90"
              )}
            >
              {errorCopy.retry}
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}
