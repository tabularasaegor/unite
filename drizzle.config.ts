import { defineConfig } from "drizzle-kit";
import path from "path";

const dataDir = process.env.DATA_DIR || ".";
const dbPath = path.resolve(dataDir, "data.db");

export default defineConfig({
  out: "./migrations",
  schema: "./shared/schema.ts",
  dialect: "sqlite",
  dbCredentials: {
    url: dbPath,
  },
});
