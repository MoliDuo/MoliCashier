-- The parse's recent-entries lookup walks documents newest first by creation
-- time, across every date and book. Only an index is added; a release that
-- does not know it is unaffected.
CREATE INDEX "idx_source_documents_created" ON "source_documents" USING btree ("created_at" DESC, "id" DESC);
