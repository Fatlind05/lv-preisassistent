import { desc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { storedDocuments } from "../../../db/schema";
import { getDocumentBucket } from "../../lib/document-storage";

const MAX_FILE_SIZE = 25 * 1024 * 1024;
const ALLOWED_EXTENSIONS = new Set(["xlsx", "pdf", "jpg", "jpeg", "png", "webp"]);
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

function fileTypeFromName(fileName: string): "xlsx" | "pdf" | "image" | null {
  const extension = fileName.split(".").pop()?.toLowerCase() ?? "";
  if (!ALLOWED_EXTENSIONS.has(extension)) return null;
  if (extension === "xlsx") return "xlsx";
  if (extension === "pdf") return "pdf";
  return "image";
}

async function fileFingerprint(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function GET(request: Request) {
  try {
    const db = await getDb();
    const fingerprint = cleanText(new URL(request.url).searchParams.get("fingerprint"), 128);
    if (fingerprint) {
      const existing = await db
        .select(publicDocumentSelection)
        .from(storedDocuments)
        .where(eq(storedDocuments.fingerprint, fingerprint))
        .limit(1);
      return Response.json({ duplicate: Boolean(existing[0]), document: existing[0] ?? null });
    }

    const documents = await db
      .select(publicDocumentSelection)
      .from(storedDocuments)
      .orderBy(desc(storedDocuments.createdAt))
      .limit(500);
    return Response.json({ documents });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Dateiarchiv konnte nicht geladen werden." },
      { status: 503 },
    );
  }
}

export async function POST(request: Request) {
  let storageKey: string | null = null;
  try {
    const formData = await request.formData();
    const value = formData.get("file");
    if (!(value instanceof File)) {
      return Response.json({ error: "Keine Datei übergeben." }, { status: 400 });
    }
    if (value.size <= 0 || value.size > MAX_FILE_SIZE) {
      return Response.json({ error: "Die Datei ist leer oder größer als 25 MB." }, { status: 400 });
    }

    const fileName = cleanText(value.name, 240);
    const fileType = fileTypeFromName(fileName);
    if (!fileType) {
      return Response.json(
        { error: "Erlaubt sind Excel (.xlsx), PDF und Bilder (JPG, PNG, WEBP)." },
        { status: 400 },
      );
    }
    const purpose = formData.get("purpose") === "new_lv" ? "new_lv" : "reference";
    const bytes = await value.arrayBuffer();
    const fingerprint = await fileFingerprint(bytes);
    const db = await getDb();
    const existing = await db
      .select(publicDocumentSelection)
      .from(storedDocuments)
      .where(eq(storedDocuments.fingerprint, fingerprint))
      .limit(1);
    if (existing[0]) {
      return Response.json({ duplicate: true, document: existing[0] });
    }

    const id = crypto.randomUUID();
    const extension = fileName.split(".").pop()?.toLowerCase() ?? "bin";
    storageKey = `lv-dokumente/${id}.${extension}`;
    const bucket = await getDocumentBucket();
    await bucket.put(storageKey, bytes, {
      httpMetadata: {
        contentType: value.type || "application/octet-stream",
        contentDisposition: `inline; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      },
      customMetadata: { fingerprint, purpose },
    });

    const document = {
      id,
      fileName,
      fileType,
      contentType: value.type || "application/octet-stream",
      fileSize: value.size,
      fingerprint,
      storageKey,
      purpose,
      status: "gespeichert",
      propertyManagement: "",
      positionCount: 0,
      reviewedAt: null,
      importedBy:
        request.headers.get("oai-authenticated-user-email")?.slice(0, 240) ?? null,
    } as const;
    await db.insert(storedDocuments).values(document);
    return Response.json({ duplicate: false, document }, { status: 201 });
  } catch (error) {
    if (storageKey) {
      try {
        const bucket = await getDocumentBucket();
        await bucket.delete(storageKey);
      } catch {
        // Die ursprüngliche Fehlermeldung bleibt maßgeblich.
      }
    }
    return Response.json(
      { error: error instanceof Error ? error.message : "Datei konnte nicht gespeichert werden." },
      { status: 500 },
    );
  }
}

export async function PATCH(request: Request) {
  try {
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

    const db = await getDb();
    await db
      .update(storedDocuments)
      .set(updates)
      .where(eq(storedDocuments.id, id));
    return Response.json({ ok: true, reviewedAt: updates.reviewedAt });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Dateistatus konnte nicht gespeichert werden." },
      { status: 500 },
    );
  }
}
