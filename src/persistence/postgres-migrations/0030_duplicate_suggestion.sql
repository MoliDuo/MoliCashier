-- A parse that finds rows the ledger already holds keeps them as entries and
-- records which ones, so the owner can confirm removing them. Only a column is
-- added; a release that does not know it ignores it.
ALTER TABLE "source_documents" ADD COLUMN "duplicate_suggestion" jsonb;--> statement-breakpoint
ALTER TABLE "source_documents" ADD CONSTRAINT "ck_source_documents_duplicate_suggestion" CHECK ("source_documents"."duplicate_suggestion" IS NULL OR jsonb_typeof("source_documents"."duplicate_suggestion") = 'object');
