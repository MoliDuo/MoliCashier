/**
 * Numbers that used to be environment variables.
 *
 * Every one of them shipped as a knob so that somebody else's deployment could
 * turn it — 30 variables, each with a Zod rule, a line in `.env.example`, a row
 * in the configuration table, and a default that no deployment has ever
 * overridden. There is one deployment. Changing a number here and pushing is
 * the same act as changing it in a dashboard and redeploying, minus the four
 * places that had to agree about what the number was allowed to be.
 *
 * What stayed in the environment is what genuinely differs between machines:
 * connection strings, credentials, the bucket, the public URL, and the switches
 * that change behaviour rather than degree.
 */

/**
 * Background leases. A worker renews its lease on every heartbeat; a lease
 * lasts several heartbeats so one slow renewal does not lose it, and only
 * decides how soon work whose process died can be claimed again.
 */
export const LEASE_HEARTBEAT_MS = 10_000;
export const LEASE_DURATION_MS = 3 * LEASE_HEARTBEAT_MS;
/** How often the background worker looks for due work when nothing wakes it. */
export const BACKGROUND_POLL_INTERVAL_MS = 5_000;
/** The in-process daily sweep: when it runs (UTC), and how soon after boot it catches up. */
export const DAILY_MAINTENANCE_HOUR_UTC = 18;
export const DAILY_MAINTENANCE_BOOT_DELAY_MS = 30_000;
/** Runs one piece of background work gets, the first one included, before it is failed. */
export const BACKGROUND_MAX_ATTEMPTS = 3;

/** OpenAI calls: how long to wait, how often to try again. */
export const AI_REQUEST_TIMEOUT_MS = 60_000;
export const AI_MAX_ATTEMPTS = 3;
/**
 * Base for the randomized backoff between attempts. Zero under test: there is
 * no provider there to be polite to, and a real backoff only slows the tests.
 */
export const AI_RETRY_DELAY_MS = process.env.NODE_ENV === "test" ? 0 : 1_000;
/**
 * The whole parse of one source document, across however many model calls. A
 * parse that runs longer fails as `processing_timeout`.
 */
export const AI_ATTEMPT_DEADLINE_MS = 5 * 60_000;

export const AI_CATEGORY_REQUEST_TIMEOUT_MS = 60_000;
/** The most entries one category assignment can be started over. */
export const CATEGORY_ASSIGNMENT_MAX_ENTRIES = 5000;

/** How many images are decoded at once; a large photo takes a few hundred megabytes to decode. */
export const IMAGE_PROCESSING_CONCURRENCY = 2;
/** JPEG quality for a normalised receipt photo. */
export const MAX_IMAGE_QUALITY = 85;

/** How long the client treats a fetched source document as fresh. */
export const SOURCE_DOC_STALE_TIME_MS = 120_000;

/** How long a signed-in session survives without being renewed. */
export const SESSION_MAX_AGE_DAYS = 14;

/** How many due extraction attempts the worker looks at per pass. */
export const PROCESSING_BATCH_SIZE = 5;

/** How far back a parse looks for entries the new evidence may repeat. */
export const RECENT_ENTRIES_WINDOW_DAYS = 14;
/** The most recent entries handed to one parse, newest first. */
export const RECENT_ENTRIES_MAX = 200;
