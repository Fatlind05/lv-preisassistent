import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

type AppDatabase = ReturnType<typeof createDatabase>;

let database: AppDatabase | null = null;

function createDatabase() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL ist nicht konfiguriert.");
  }

  return drizzle(neon(databaseUrl), { schema });
}

export function getDb(): AppDatabase {
  database ??= createDatabase();
  return database;
}
