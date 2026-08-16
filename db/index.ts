import { drizzle } from "drizzle-orm/d1";

type AppDatabase = ReturnType<typeof drizzle>;

/**
 * Temporary Vercel preview boundary. The original application uses Cloudflare
 * D1. Failing lazily lets the Next.js UI render while preventing accidental
 * writes to an unconfigured database.
 */
export async function getDb(): Promise<AppDatabase> {
  throw new Error(
    "Die Preisbibliothek ist in dieser Vorschau noch nicht eingerichtet.",
  );
}
