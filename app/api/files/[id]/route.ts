import { eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { storedDocuments } from "../../../../db/schema";
import { getDocumentBucket } from "../../../lib/document-storage";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const db = await getDb();
    const rows = await db
      .select()
      .from(storedDocuments)
      .where(eq(storedDocuments.id, id.slice(0, 80)))
      .limit(1);
    const document = rows[0];
    if (!document) return new Response("Datei nicht gefunden.", { status: 404 });

    const bucket = await getDocumentBucket();
    const object = await bucket.get(document.storageKey);
    if (!object) return new Response("Dateiinhalt nicht gefunden.", { status: 404 });

    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set("content-type", document.contentType || "application/octet-stream");
    headers.set(
      "content-disposition",
      `inline; filename*=UTF-8''${encodeURIComponent(document.fileName)}`,
    );
    headers.set("cache-control", "private, no-store");
    headers.set("x-content-type-options", "nosniff");
    return new Response(object.body, { headers });
  } catch (error) {
    return new Response(
      error instanceof Error ? error.message : "Datei konnte nicht geöffnet werden.",
      { status: 500 },
    );
  }
}
