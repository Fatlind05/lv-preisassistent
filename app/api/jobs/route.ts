import { desc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { processingJobs } from "../../../db/schema";
import { isUniqueViolation, safeErrorResponse } from "../../lib/route-errors";
import { requireActor } from "../../lib/server-auth";

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
    await requireActor();
    const jobs = await getDb()
      .select()
      .from(processingJobs)
      .orderBy(desc(processingJobs.createdAt))
      .limit(12);
    return Response.json({ jobs });
  } catch (error) {
    return safeErrorResponse(error, "Verlauf konnte nicht geladen werden.", 503);
  }
}

export async function POST(request: Request) {
  let fingerprint = "";
  try {
    const actor = await requireActor();
    const payload = (await request.json()) as JobPayload;
    const fileName = cleanText(payload.fileName, 240);
    fingerprint = cleanText(payload.fingerprint, 128);
    if (!fileName || !/^[0-9a-f]{64}$/i.test(fingerprint)) {
      return Response.json({ error: "Ungültiger Auftrag." }, { status: 400 });
    }

    const db = getDb();
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
      processedBy: actor.email || actor.userId,
    };

    await db.insert(processingJobs).values(job);
    return Response.json({ job }, { status: 201 });
  } catch (error) {
    if (isUniqueViolation(error) && fingerprint) {
      const existing = await getDb()
        .select()
        .from(processingJobs)
        .where(eq(processingJobs.fingerprint, fingerprint))
        .limit(1);
      if (existing[0]) return Response.json({ job: existing[0], duplicate: true });
    }
    return safeErrorResponse(error, "Auftrag konnte nicht gespeichert werden.");
  }
}
