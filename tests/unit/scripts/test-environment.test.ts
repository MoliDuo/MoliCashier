import { describe, expect, it } from "vitest";
import { validateStartupEnv } from "@/lib/env/startup";
import {
  TEST_DATABASE_PLACEHOLDER,
  TEST_STARTUP_ENV,
  createTestEnvironment,
  installTestEnvironment,
} from "../../../scripts/test-environment";

describe("test environment", () => {
  it("overrides inherited startup configuration with isolated placeholders", () => {
    const inherited = {
      ...Object.fromEntries(Object.keys(TEST_STARTUP_ENV).map((key) => [key, `real-${key}`])),
      NODE_ENV: "development",
    } as NodeJS.ProcessEnv;
    const environment = createTestEnvironment({ ...inherited, PATH: "/bin" });

    expect(environment).toMatchObject(TEST_STARTUP_ENV);
    expect(environment.DATABASE_URL).toBe(TEST_DATABASE_PLACEHOLDER);
    expect(environment.NODE_ENV).toBe("test");
    expect((environment as Record<string, string | undefined>)["PATH"]).toBe("/bin");
    expect(() => validateStartupEnv(environment as NodeJS.ProcessEnv)).not.toThrow();
    const validated = validateStartupEnv(environment as NodeJS.ProcessEnv);
    expect(validated.AI_MODEL).toBe("test-model");
  });

  it("installs placeholders into an existing environment and permits explicit overrides", () => {
    const environment = {
      NODE_ENV: "development",
      OPENAI_API_KEY: "real-secret",
    } as NodeJS.ProcessEnv;
    installTestEnvironment(environment, { NODE_ENV: "production" });

    expect(environment.OPENAI_API_KEY).toBe("test-openai-key");
    expect(environment.NODE_ENV).toBe("production");
  });

  it("runs at UTC whatever the machine's zone unless CASHIER_TEST_TZ names one", () => {
    expect(createTestEnvironment({ TZ: "America/New_York" }).TZ).toBe("");

    const singapore = createTestEnvironment({
      TZ: "America/New_York",
      CASHIER_TEST_TZ: "Asia/Singapore",
    });
    expect(singapore.TZ).toBe("Asia/Singapore");
    // A worker's setup installs the environment again; the zone survives it.
    expect(installTestEnvironment({ ...singapore }).TZ).toBe("Asia/Singapore");
    expect(installTestEnvironment({ TZ: "America/New_York" }).TZ).toBe("");
  });
});
