-- The daily cleanup deletes a file no document has used for a week. It counted
-- the week from the upload, so an old file a document had just let go of (an
-- input replaced, a record deleted) went the next night. A trigger on the file
-- links now stamps the file whenever a document takes or lets go of it, and
-- the cleanup counts from that. Only a column, a function, a trigger and an
-- index are added; a release that does not know them still runs.
ALTER TABLE "stored_files" ADD COLUMN "last_used_at" timestamp with time zone;--> statement-breakpoint

CREATE FUNCTION record_stored_file_use() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  UPDATE stored_files SET last_used_at = now()
  WHERE id = CASE WHEN TG_OP = 'DELETE' THEN OLD.stored_file_id ELSE NEW.stored_file_id END;
  RETURN NULL;
END $$;--> statement-breakpoint

-- A deleted document's links go by cascade, which fires this as well.
CREATE TRIGGER trg_source_document_files_stored_file_use
  AFTER INSERT OR DELETE ON source_document_files
  FOR EACH ROW EXECUTE FUNCTION record_stored_file_use();--> statement-breakpoint

-- Deleting a category assignment run sets its retries' link to null; this finds them.
CREATE INDEX "idx_category_assignment_jobs_retry_of_job" ON "category_assignment_jobs" USING btree ("retry_of_job_id");
