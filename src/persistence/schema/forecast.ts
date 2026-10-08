import { boolean, date, jsonb, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { rowTimestamp } from "./columns";

/**
 * The AI analyst's judgment of the ledger as of one day, per scope — every
 * book together (`all`) or one book's id. It is derived, but from a model
 * call that costs money and does not repeat itself, so it is kept: the page
 * reads the latest, and the older ones are scored against what was then spent.
 * A second judgment of the same day replaces the first.
 */
export const forecastJudgments = pgTable(
  "forecast_judgments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    scope: text("scope").notNull(),
    asOf: date("as_of", { mode: "string" }).notNull(),
    /** A digest of the history the judgment read, to tell when entries have changed since. */
    inputFingerprint: text("input_fingerprint").notNull(),
    model: text("model").notNull(),
    /** Judged afterwards, for a past day, from only what was recorded by then. */
    backfilled: boolean("backfilled").notNull().default(false),
    /** Checked against the forecast module's judgment schema when read. */
    judgment: jsonb("judgment").$type<unknown>().notNull(),
    createdAt: rowTimestamp("created_at"),
  },
  (table) => [uniqueIndex("uq_forecast_judgments_scope_as_of").on(table.scope, table.asOf)]
);
