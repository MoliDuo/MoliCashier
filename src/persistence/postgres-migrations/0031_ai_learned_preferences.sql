-- The owner's corrections to what the AI wrote are kept as differences, and the
-- daily maintenance distills them into a learned-preferences text beside the
-- hand-written prompt. Only columns and a table are added; a release that does
-- not know them ignores them. The learned text and its switch are settings
-- another device shows, so the settings trigger now watches them too.
CREATE TABLE "ai_corrections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_document_id" uuid NOT NULL,
	"subject_id" uuid NOT NULL,
	"field" text NOT NULL,
	"document_title" text,
	"item_name" text,
	"amount" numeric(21, 3),
	"currency" varchar(3),
	"before_value" text NOT NULL,
	"after_value" text NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_ai_corrections_field" CHECK ("ai_corrections"."field" IN ('category', 'item_name', 'title'))
);
--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD COLUMN "extracted" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "ledgers" ADD COLUMN "ai_learned_preferences" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "ledgers" ADD COLUMN "ai_learned_preferences_updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ledgers" ADD COLUMN "ai_preference_learning_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "category_assignment_jobs" ADD COLUMN "learned_preferences_snapshot" text;--> statement-breakpoint
ALTER TABLE "ai_corrections" ADD CONSTRAINT "fk_ai_corrections_source_document" FOREIGN KEY ("source_document_id") REFERENCES "public"."source_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_ai_corrections_subject_field" ON "ai_corrections" USING btree ("subject_id","field");--> statement-breakpoint
CREATE INDEX "idx_ai_corrections_unconsumed" ON "ai_corrections" USING btree ("updated_at") WHERE "ai_corrections"."consumed_at" IS NULL;--> statement-breakpoint
CREATE INDEX "idx_ai_corrections_source_document" ON "ai_corrections" USING btree ("source_document_id");--> statement-breakpoint
ALTER TABLE "ledgers" ADD CONSTRAINT "ck_ledgers_ai_learned_preferences_length" CHECK (length("ledgers"."ai_learned_preferences") <= 2000);--> statement-breakpoint
DROP TRIGGER IF EXISTS trg_ledgers_settings_change_log ON ledgers;--> statement-breakpoint
CREATE TRIGGER trg_ledgers_settings_change_log
  AFTER UPDATE OF ai_language, preferred_currencies, main_currency, collapse_entries_default,
    ai_custom_prompt, time_zone, ai_learned_preferences, ai_preference_learning_enabled
  ON ledgers FOR EACH ROW EXECUTE FUNCTION record_ledger_change('settings');
