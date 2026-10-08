"use client";

import { useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { textRoleClassName } from "@/components/typography";
import { authCopy, type LoginMessageKey } from "@/copy/auth";
import { devSignInAction } from "../server-actions/sign-in";

export function AuthLoginPage({
  messageKey = null,
  callbackUrl = "/",
  devAuthAvailable = false,
  ledgerMissing = false,
}: {
  messageKey?: LoginMessageKey | null;
  callbackUrl?: string;
  devAuthAvailable?: boolean;
  ledgerMissing?: boolean;
}) {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [devError, setDevError] = useState<string | null>(null);
  const message = messageKey == null ? null : authCopy.messages[messageKey];

  const handleDevSignIn = async () => {
    setIsLoading(true);
    setDevError(null);
    try {
      const result = await devSignInAction();
      if (!result.ok) throw new Error("dev sign-in refused");
      router.push(callbackUrl);
      router.refresh();
    } catch {
      setDevError(authCopy.devSignInFailed);
      setIsLoading(false);
    }
  };

  return (
    <main
      id="main-content"
      tabIndex={-1}
      className="flex min-h-dvh items-center justify-center bg-bg px-4 py-8"
    >
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <Image
            src="/icon.svg"
            alt=""
            width={48}
            height={48}
            unoptimized
            className="mx-auto mb-4"
          />
          <h1 className={textRoleClassName("pageTitle")}>
            <span translate="no">Moli Cashier</span>
          </h1>
          <p className={textRoleClassName("bodyMuted", "mt-2")}>{authCopy.productTagline}</p>
        </div>

        <div className="rounded-lg border border-border bg-surface p-6 shadow-none">
          {ledgerMissing ? (
            <div role="status" className="mb-5 rounded-md bg-surface2 p-3">
              <p className={textRoleClassName("bodyStrong")}>{authCopy.noLedgerTitle}</p>
              <p className={textRoleClassName("bodyMuted", "mt-1")}>{authCopy.noLedgerDesc}</p>
              <pre className={textRoleClassName("meta", "mt-2 overflow-x-auto text-text")}>
                <code translate="no">npm run ledger:create</code>
              </pre>
            </div>
          ) : null}
          {message != null ? (
            <div
              role={message.tone === "error" ? "alert" : "status"}
              className={textRoleClassName(
                "body",
                message.tone === "error"
                  ? "mb-5 rounded-md bg-destructive/10 p-3 text-destructive"
                  : "mb-5 rounded-md bg-surface2 p-3"
              )}
            >
              <p className={textRoleClassName("bodyStrong")}>{message.title}</p>
              <p className="mt-1">{message.desc}</p>
            </div>
          ) : null}
          {ledgerMissing ? null : (
            // A plain link: the route answers with a redirect to another origin, which a
            // client-side navigation or prefetch must not try to follow.
            <Button asChild className="min-h-11 w-full">
              <a href={`/api/auth/login?callbackUrl=${encodeURIComponent(callbackUrl)}`}>
                {message == null ? authCopy.signIn : authCopy.signInAgain}
              </a>
            </Button>
          )}
        </div>

        {devAuthAvailable ? (
          <div className="mt-4 rounded-md border border-dashed border-border bg-surface2/60 p-3 text-center">
            <p className={textRoleClassName("meta")}>{authCopy.devSignInDesc}</p>
            <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
              <button
                type="button"
                onClick={() => void handleDevSignIn()}
                disabled={isLoading}
                className={textRoleClassName(
                  "bodyStrong",
                  "inline-flex min-h-11 items-center justify-center rounded-md border border-border bg-surface px-3 transition-colors hover:bg-surface2 disabled:opacity-50"
                )}
              >
                {authCopy.devSignIn}
              </button>
            </div>
            {devError != null ? (
              <p role="alert" className={textRoleClassName("meta", "mt-2 text-destructive")}>
                {devError}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </main>
  );
}
