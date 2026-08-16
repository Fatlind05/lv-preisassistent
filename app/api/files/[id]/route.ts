import { get } from "@vercel/blob";
import { eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { storedDocuments } from "../../../../db/schema";
import { UnauthorizedError, requireActor } from "../../../lib/server-auth";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    await requireActor();
    const { id } = await context.params;
    const rows = await getDb()
      .select()
      .from(storedDocuments)
      .where(eq(storedDocuments.id, id.slice(0, 80)))
      .limit(1);
    const document = rows[0];
    if (!document) return new Response("Datei nicht gefunden.", { status: 404 });

    const object = await get(document.storageKey, {
      access: "private",
      useCache: false,
    });
    if (!object || object.statusCode !== 200) {
      return new Response("Dateiinhalt nicht gefunden.", { status: 404 });
    }

    const headers = new Headers();
    object.headers.forEach((value, key) => headers.set(key, value));
    headers.set("content-type", document.contentType || "application/octet-stream");
    headers.set(
      "content-disposition",
      `inline; filename*=UTF-8''${encodeURIComponent(document.fileName)}`,
    );
    headers.set("cache-control", "private, no-store");
    headers.set("x-content-type-options", "nosniff");
    return new Response(object.stream, { headers });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return new Response("Bitte zuerst anmelden.", { status: 401 });
    }
    const reference = crypto.randomUUID().slice(0, 8);
    console.error(`[${reference}] Datei konnte nicht geöffnet werden.`, error);
    return new Response(`Datei konnte nicht geöffnet werden. Referenz: ${reference}`, {
      status: 500,
    });
  }
}
