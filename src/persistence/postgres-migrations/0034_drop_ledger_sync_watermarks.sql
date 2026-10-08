-- The per-resource watermarks on the change log have had no reader since the
-- release before this one, which neither reads nor writes them. The triggers
-- stop keeping them first, then the columns go.
CREATE OR REPLACE FUNCTION record_ledger_change() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  LOOP
    -- A transaction's later changes reuse its version; updating this one row
    -- serializes concurrent writers.
    UPDATE ledger_sync_state SET
      version = CASE WHEN transaction_id = txid_current() THEN version ELSE version + 1 END,
      transaction_id = txid_current(),
      updated_at = now();
    EXIT WHEN FOUND;
    INSERT INTO ledger_sync_state DEFAULT VALUES ON CONFLICT DO NOTHING;
  END LOOP;
  RETURN NULL;
END $$;--> statement-breakpoint

-- A new rate still changes converted figures, so it keeps moving the version.
CREATE OR REPLACE FUNCTION record_exchange_rate_change() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM changed_rates) THEN
    RETURN NULL;
  END IF;
  INSERT INTO ledger_sync_state DEFAULT VALUES ON CONFLICT DO NOTHING;
  UPDATE ledger_sync_state SET
    version = version + CASE WHEN transaction_id = txid_current() THEN 0 ELSE 1 END,
    transaction_id = txid_current(),
    updated_at = now();
  RETURN NULL;
END $$;--> statement-breakpoint

ALTER TABLE "ledger_sync_state" DROP COLUMN "categories_version";--> statement-breakpoint
ALTER TABLE "ledger_sync_state" DROP COLUMN "settings_version";--> statement-breakpoint
ALTER TABLE "ledger_sync_state" DROP COLUMN "stats_version";
