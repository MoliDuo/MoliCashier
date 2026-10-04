-- The forecast's AI analyst keeps its judgment of the ledger per scope and day,
-- so the page reads the latest and older ones are scored against what was spent.
-- Only a table is added; a release that does not know it ignores it.
CREATE TABLE "forecast_judgments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scope" text NOT NULL,
	"as_of" date NOT NULL,
	"input_fingerprint" text NOT NULL,
	"model" text NOT NULL,
	"backfilled" boolean DEFAULT false NOT NULL,
	"judgment" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "uq_forecast_judgments_scope_as_of" ON "forecast_judgments" USING btree ("scope","as_of");
