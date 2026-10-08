"use client";
import { useEffect } from "react";
import { RefreshCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { textRoleClassName } from "@/components/typography";
import { errorCopy, routeErrorCopy } from "@/copy/app";

/**
 * A ledger route that failed to render. The boundary sits below the shared
 * layout, so the bars and the tabs stay on screen and the reader can retry the
 * page or move to another one.
 */
export default function LedgerRouteError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div
      role="alert"
      className="my-8 flex flex-col items-center gap-3 rounded-lg border border-danger/30 bg-danger/5 px-4 py-10 text-center"
    >
      <h1 className={textRoleClassName("sectionTitle")}>{routeErrorCopy.title}</h1>
      <p className={textRoleClassName("bodyMuted")}>{routeErrorCopy.description}</p>
      {error.digest != null ? (
        <p className={textRoleClassName("meta", "font-mono")}>
          {errorCopy.errorId({ id: error.digest })}
        </p>
      ) : null}
      <Button type="button" variant="outline" className="gap-2 max-md:h-11" onClick={() => retry()}>
        <RefreshCcw aria-hidden="true" className="size-4" />
        {errorCopy.retry}
      </Button>
    </div>
  );
}
