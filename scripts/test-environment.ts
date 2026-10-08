export const TEST_DATABASE_PLACEHOLDER = "postgresql://cashier:cashier@127.0.0.1:1/cashier_test";

export const TEST_STARTUP_ENV = Object.freeze({
  DATABASE_URL: TEST_DATABASE_PLACEHOLDER,
  OPENAI_API_KEY: "test-openai-key",
  OPENAI_BASE_URL: "",
  AUTH_SECRET: "test-auth-secret",
  APP_URL: "http://localhost:3000",
  OIDC_ISSUER_URL: "http://127.0.0.1:1",
  OIDC_CLIENT_ID: "test-client",
  OIDC_CLIENT_SECRET: "test-client-secret",
  S3_ENDPOINT: "http://127.0.0.1:1",
  S3_REGION: "",
  S3_BUCKET: "cashier-test-images",
  S3_ACCESS_KEY_ID: "test-access-key",
  S3_SECRET_ACCESS_KEY: "test-secret-key",
  S3_FORCE_PATH_STYLE: "",
  TZ: "",
  AI_MODEL: "test-model",
  LOG_LEVEL: "",
  DEV_AUTH_BYPASS: "",
  DATABASE_POOL_MAX: "",
});

type Overrides = Partial<NodeJS.ProcessEnv>;

/**
 * Tests run at UTC (an empty `TZ`) whatever the machine's zone, unless
 * `CASHIER_TEST_TZ` names another one. `npm run test:unit:sg` sets it to run the
 * unit suite again at Asia/Singapore, where code that only works at UTC fails.
 * The variable, not `TZ`, carries the choice, so the workers' own setup keeps it.
 */
export const TEST_TIME_ZONE_VARIABLE = "CASHIER_TEST_TZ";

function testTimeZone(environment: Overrides): string {
  return environment[TEST_TIME_ZONE_VARIABLE] ?? "";
}

export function createTestEnvironment(
  baseEnvironment: Overrides = process.env,
  overrides: Overrides = {}
): NodeJS.ProcessEnv {
  return {
    ...baseEnvironment,
    ...TEST_STARTUP_ENV,
    TZ: testTimeZone(baseEnvironment),
    NODE_ENV: "test" as const,
    ...overrides,
  };
}

export function installTestEnvironment(
  environment: Overrides = process.env,
  overrides: Overrides = {}
): Overrides {
  Object.assign(
    environment,
    TEST_STARTUP_ENV,
    { TZ: testTimeZone(environment), NODE_ENV: "test" },
    overrides
  );
  return environment;
}
