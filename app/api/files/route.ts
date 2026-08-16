import { desc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { storedDocuments } from "../../../db/schema";
import { safeErrorResponse } from "../../lib/route-errors";
import { requireActor } from "../../lib/server-auth";

const publicDocumentSelection = {
  id: storedDocuments.id,
  fileName: storedDocuments.fileName,
  fileType: storedDocuments.fileType,
  contentType: storedDocuments.contentType,
  fileSize: storedDocuments.fileSize,
  fingerprint: storedDocuments.fingerprint,
  purpose: storedDocuments.purpose,
  status: storedDocuments.status,
  propertyManagement: storedDocuments.propertyManagement,
  positionCount: storedDocuments.positionCount,
  reviewedAt: storedDocuments.reviewedAt,
  importedBy: storedDocuments.importedBy,
  createdAt: storedDocuments.createdAt,
  updatedAt: storedDocuments.updatedAt,
};

function cleanText(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export async function GET(request: Request) {
  try {
    await requireActor();
    const db = getDb();
    const fingerprint = cleanText(
      new URL(request.url).searchParams.get("fingerprint"),
      128,
    );
    if (fingerprint) {
      const existing = await db
        .select(publicDocumentSelection)
        .from(storedDocuments)
        .where(eq(storedDocuments.fingerprint, fingerprint))
        .limit(1);
      return Response.json({
        duplicate: Boolean(existing[0]),
        document: existing[0] ?? null,
      });
    }

    const documents = await db
      .select(publicDocumentSelection)
      .from(storedDocuments)
      .orderBy(desc(storedDocuments.createdAt))
      .limit(500);
    return Response.json({ documents });
  } catch (error) {
    return safeErrorResponse(error, "Dateiarchiv konnte nicht geladen werden.", 503);
  }
}

export async function PATCH(request: Request) {
  try {
    await requireActor();
    const payload = (await request.json()) as {
      id?: string;
      status?: string;
      propertyManagement?: string;
      positionCount?: number;
      reviewed?: boolean;
    };
    const id = cleanText(payload.id, 80);
    const allowedStatus = ["gespeichert", "eingelesen", "verarbeitet", "pruefen", "fehler"];
    if (!id) return Response.json({ error: "Datei-ID fehlt." }, { status: 400 });

    const updates: Partial<typeof storedDocuments.$inferInsert> = {
      updatedAt: new Date().toISOString(),
    };
    if (payload.status !== undefined) {
      const status = cleanText(payload.status, 24);
      if (!allowedStatus.includes(status)) {
        return Response.json({ error: "Unbekannter Dateistatus." }, { status: 400 });
      }
      updates.status = status;
    }
    if (payload.propertyManagement !== undefined) {
      updates.propertyManagement = cleanText(payload.propertyManagement, 160);
    }
    if (payload.positionCount !== undefined) {
      updates.positionCount = Math.max(
        0,
        Math.min(100_000, Math.round(Number(payload.positionCount) || 0)),
      );
    }
    if (typeof payload.reviewed === "boolean") {
      updates.reviewedAt = payload.reviewed ? new Date().toISOString() : null;
    }
    if (Object.keys(updates).length === 1) {
      return Response.json({ error: "Keine Änderung übergeben." }, { status: 400 });
    }

    const db = getDb();
    const updated = await db
      .update(storedDocuments)
      .set(updates)
      .where(eq(storedDocuments.id, id))
      .returning({ id: storedDocuments.id });
    if (!updated[0]) {
      return Response.json({ error: "Datei nicht gefunden." }, { status: 404 });
    }
    return Response.json({ ok: true, reviewedAt: updates.reviewedAt });
  } catch (error) {
    return safeErrorResponse(error, "Dateistatus konnte nicht gespeichert werden.");
  }
}
