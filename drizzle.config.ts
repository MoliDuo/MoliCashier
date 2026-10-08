import { defineConfig } from "drizzle-kit";
import fs from "fs";
import path from "path";

function loadLocalDatabaseUrl() {
  if (process.env.DATABASE_URL != null) return;
  for (const filename of [".env.local", ".env"]) {
    try {
      const envPath = path.resolve(process.cwd(), filename);
      if (!fs.existsSync(envPath)) continue;
      const match = fs.readFileSync(envPath, "utf8").match(/^DATABASE_URL=(.+)$/m);
      if (match?.[1] != null) {
        process.env.DATABASE_URL = match[1].trim().replace(/^(['"])(.*)\1$/, "$2");
        return;
      }
    } catch (error) {
      console.warn(`Failed to load DATABASE_URL from ${filename}:`, error);
    }
  }
}

loadLocalDatabaseUrl();

export default defineConfig({
  schema: [
    "./src/persistence/schema/auth.ts",
    "./src/persistence/schema/currency.ts",
    "./src/persistence/schema/ledger.ts",
    "./src/persistence/schema/source-document.ts",
    "./src/persistence/schema/stored-files.ts",
    "./src/persistence/schema/category-assignment.ts",
    "./src/persistence/schema/forecast.ts",
    "./src/persistence/relations.ts",
  ],
  out: "./src/persistence/postgres-migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
});
