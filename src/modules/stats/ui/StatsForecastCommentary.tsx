"use client";
import { Sparkles } from "lucide-react";
import { useState } from "react";
import { textRoleClassName } from "@/components/typography";
import { Button } from "@/components/ui/button";
import type { ForecastCommentaryDto, ForecastDto } from "@/modules/forecast/contracts";
import { forecastCopy } from "@/copy/stats";

type CommentaryState =
  { status: "loading" } | { status: "failed" } | { status: "done"; sentences: string[] };

interface StatsForecastCommentaryProps {
  forecast: ForecastDto;
  /** Asks the server for the model's sentences on the same forecast. */
  requestCommentary: () => Promise<ForecastCommentaryDto | null>;
}

/**
 * A button that asks the AI to say in a few sentences where the period is
 * heading. Only on request, never stored: the answer belongs to the forecast
 * it was asked about and is dropped when the forecast changes.
 */
export function StatsForecastCommentary({
  forecast,
  requestCommentary,
}: StatsForecastCommentaryProps) {
  const [answer, setAnswer] = useState<{ forecast: ForecastDto; state: CommentaryState } | null>(
    null
  );
  const state = answer?.forecast === forecast ? answer.state : null;

  const ask = () => {
    setAnswer({ forecast, state: { status: "loading" } });
    requestCommentary().then(
      (reply) =>
        setAnswer((current) =>
          current?.forecast !== forecast
            ? current
            : {
                forecast,
                state:
                  reply == null || reply.sentences.length === 0
                    ? { status: "failed" }
                    : { status: "done", sentences: reply.sentences },
              }
        ),
      () =>
        setAnswer((current) =>
          current?.forecast !== forecast ? current : { forecast, state: { status: "failed" } }
        )
    );
  };

  return (
    <div className="space-y-2 border-t border-border pt-4">
      {state?.status === "done" ? (
        <div className="space-y-1" aria-live="polite">
          {state.sentences.map((sentence, index) => (
            <p key={index} className={textRoleClassName("body")}>
              {sentence}
            </p>
          ))}
        </div>
      ) : (
        <>
          <Button variant="outline" size="sm" disabled={state?.status === "loading"} onClick={ask}>
            <Sparkles aria-hidden="true" />
            {state?.status === "loading" ? forecastCopy.commentaryLoading : forecastCopy.commentary}
          </Button>
          {state?.status === "failed" ? (
            <p role="alert" className={textRoleClassName("meta", "text-destructive")}>
              {forecastCopy.commentaryFailed}
            </p>
          ) : (
            <p className={textRoleClassName("meta")}>{forecastCopy.commentaryHint}</p>
          )}
        </>
      )}
    </div>
  );
}
