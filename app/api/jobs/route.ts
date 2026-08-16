import { desc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { processingJobs } from "../../../db/schema";

type JobPayload = {
  fileName?: string;
  fileType?: string;
  fingerprint?: string;
  totalPositions?: number;
  matchedCount?: number;
  openCount?: number;
};

function cleanText(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function cleanCount(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0
    ? Math.min(Math.round(number), 100_000)
    : 0;
}

export async function GET() {
  try {
    const db = await getDb();
    const jobs = await db
      .select()
      .from(processingJobs)
      .orderBy(desc(processingJobs.createdAt))
      .limit(12);
    return Response.json({ jobs });
  } catch {
    return Response.json({ jobs: [] });
  }
}

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as JobPayload;
    const fileName = cleanText(payload.fileName, 240);
    const fingerprint = cleanText(payload.fingerprint, 128);
    if (!fileName || !fingerprint) {
      return Response.json({ error: "Ungültiger Auftrag." }, { status: 400 });
    }

    const db = await getDb();
    const existing = await db
      .select()
      .from(processingJobs)
      .where(eq(processingJobs.fingerprint, fingerprint))
      .limit(1);
    if (existing[0]) {
      return Response.json({ job: existing[0], duplicate: true });
    }
    const job = {
      id: crypto.randomUUID(),
      fileName,
      fileType: cleanText(payload.fileType, 24) || "unbekannt",
      fingerprint,
      totalPositions: cleanCount(payload.totalPositions),
      matchedCount: cleanCount(payload.matchedCount),
      openCount: cleanCount(payload.openCount),
      processedBy:
        request.headers.get("oai-authenticated-user-email")?.slice(0, 240) ??
        null,
    };

    await db.insert(processingJobs).values(job);
    return Response.json({ job }, { status: 201 });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Auftrag konnte nicht gespeichert werden." },
      { status: 500 },
    );
  }
}
