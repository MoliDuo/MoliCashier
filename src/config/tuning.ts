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
/**
 * The most entries of one document sent in one category assignment request. A
 * document with more is asked in blocks of this size, each one a checkpoint.
 */
export const CATEGORY_ASSIGNMENT_REQUEST_CHUNK_SIZE = 50;

/** The most records one page of 账目 holds; the browser asks for this many. */
export const STREAM_PAGE_LIMIT = 20;

/** How many images are decoded at once; a large photo takes a few hundred megabytes to decode. */
export const IMAGE_PROCESSING_CONCURRENCY = 2;
/** JPEG quality for a normalised receipt photo. */
export const MAX_IMAGE_QUALITY = 85;

/** How long a signed-in session survives without being renewed. */
export const SESSION_MAX_AGE_DAYS = 14;
/** How long a session lasts from sign-in however often it is renewed; after it the provider is asked again. */
export const SESSION_ABSOLUTE_MAX_AGE_DAYS = 30;

/**
 * How many source documents one API v1 credential may create: a burst of this many a minute, and
 * this many a day. Each allowance refills evenly over its period (a token bucket).
 */
export const API_V1_CREATES_PER_MINUTE = 30;
export const API_V1_CREATES_PER_DAY = 300;

/**
 * How many extraction attempts run at once. Each holds its images decoded and base64-encoded in
 * memory and one model request open, and the provider's rate limit is shared; more due attempts
 * wait their turn in the queue.
 */
export const PROCESSING_CONCURRENCY = 3;

/** How far back a parse looks for entries the new evidence may repeat. */
export const RECENT_ENTRIES_WINDOW_DAYS = 14;
/** The most recent entries handed to one parse, newest first. */
export const RECENT_ENTRIES_MAX = 200;

/** Fewer unread corrections than this are too thin to learn a preference from. */
export const PREFERENCE_LEARNING_MIN_CORRECTIONS = 3;
/** The most unread corrections one learning run reads. */
export const PREFERENCE_LEARNING_MAX_NEW = 60;
/** The most already-read corrections shown to a run as background. */
export const PREFERENCE_LEARNING_MAX_BACKGROUND = 40;
/** How far back the background corrections reach. */
export const PREFERENCE_LEARNING_BACKGROUND_DAYS = 90;
/** How many preferences the learned text holds, and the longest one. */
export const PREFERENCE_LEARNING_MAX_RULES = 15;
export const PREFERENCE_LEARNING_RULE_MAX_CHARS = 160;
/** How long a corrections row that a run already read is kept. */
export const AI_CORRECTIONS_RETENTION_DAYS = 180;

/** How far back the 统计 forecast reads; older days have faded to nothing by then anyway. */
export const FORECAST_HISTORY_DAYS = 730;
/**
 * How fast the forecast lets the past fade: a day this many days old counts half as much as yesterday.
 * Back-tests over 14 / 30 / 60 / 120 days and no fading picked 14 for every book with enough history.
 */
export const FORECAST_HALF_LIFE_DAYS = 14;
/** How many times the forecast plays out the rest of a period. */
export const FORECAST_SIMULATION_PATHS = 1000;
/** Fewer recorded days than this before today are too few for the forecast to learn from. */
export const FORECAST_MIN_HISTORY_DAYS = 7;
/** What a day from before the current way of spending began counts for in the forecast, against a day since. */
export const FORECAST_CHANGE_DISCOUNT = 0.2;
/** Fewer paths than the page's forecast for the statistical reference the AI is handed and for scoring it: no fans are drawn from them. */
export const FORECAST_REFERENCE_PATHS = 300;
/** The most characters of ledger the forecast judgment sends the AI; older documents are summarized first beyond it. */
export const FORECAST_AI_INPUT_MAX_CHARS = 120_000;
/** How much of a document's original input the judgment shows the AI. */
export const FORECAST_AI_INPUT_TEXT_CHARS = 160;
/** How far ahead the AI lists what it expects to come. */
export const FORECAST_AI_EXPECTED_DAYS = 90;
/**
 * Leads the fingerprint a judgment is stored with. Raise it whenever the analyst's prompt or what it is asked
 * for changes, so today's judgment, made the old way, is redone on the next read or night instead of tomorrow.
 */
export const FORECAST_AI_JUDGMENT_VERSION = 2;
/** A scope still without today's judgment, say after a failure, is not asked again sooner than this after the last attempt. */
export const FORECAST_AI_REFRESH_MINUTES = 30;
/** A judgment older than this many days is not used for the page's forecast. */
export const FORECAST_AI_MAX_AGE_DAYS = 2;
/** The past Mondays judged once the AI analyst starts, so its record is known from the first day. */
export const FORECAST_AI_BACKFILL_WEEKS = 12;
/** How far ahead a past judgment is scored against what was then spent. */
export const FORECAST_AI_ACCURACY_HORIZON_DAYS = 14;
/**
 * The most a category's judged everyday day may cost, as a multiple of the 99th percentile of its past days
 * with spending; something the AI expects is held to the same multiple of the category's largest past day.
 * A misread answer — a month's spending given as a day's — then cannot multiply the forecast.
 */
export const FORECAST_AI_AMOUNT_CAP_MULTIPLE = 1.5;
/** How long judgments are kept for scoring. */
export const FORECAST_AI_RETENTION_DAYS = 400;
/**
 * The most tokens one judgment may spend, the model's reasoning included: a reasoning model that runs out
 * mid-thought returns nothing. Unrestrained, the deployed model reasoned for over 40,000 tokens on a real
 * ledger; with `FORECAST_AI_REASONING_EFFORT` it needs about a third of that.
 */
export const FORECAST_AI_MAX_TOKENS = 200_000;
/** Thinking hard about two years of ledger takes minutes; a low effort keeps it to one, with the same findings. */
export const FORECAST_AI_REASONING_EFFORT = "low";
/** How long one judgment may take before it is given up; far more than a parse, since the model reasons over the whole ledger. */
export const FORECAST_AI_TIMEOUT_MS = 300_000;
/** A judgment is tried this many times; each try is long, so fewer than the default. */
export const FORECAST_AI_MAX_ATTEMPTS = 2;
