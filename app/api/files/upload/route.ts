import { del, get } from "@vercel/blob";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { getDb } from "../../../../db";
import { storedDocuments } from "../../../../db/schema";
import {
  cleanFileName,
  hasExpectedMagic,
  MAX_FILE_SIZE,
  supportedFile,
  validateFileMetadata,
} from "../../../lib/file-policy";
import { isUniqueViolation, safeErrorResponse } from "../../../lib/route-errors";
import { requireActor } from "../../../lib/server-auth";

type UploadMetadata = {
  id: string;
  fileName: string;
  fingerprint: string;
  purpose: "reference" | "new_lv";
  importedBy: string;
  pathname: string;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FINGERPRINT_PATTERN = /^[0-9a-f]{64}$/i;

function parseClientPayload(value: string | null, pathname: string): UploadMetadata {
  let input: Record<string, unknown>;
  try {
    input = JSON.parse(value ?? "") as Record<string, unknown>;
  } catch {
    throw new Error("Ungültige Upload-Metadaten.");
  }

  const id = typeof input.id === "string" ? input.id : "";
  const fileName = cleanFileName(input.fileName);
  const fingerprint = typeof input.fingerprint === "string" ? input.fingerprint : "";
  const purpose = input.purpose === "new_lv" ? "new_lv" : "reference";
  const file = supportedFile(fileName);
  if (!UUID_PATTERN.test(id) || !FINGERPRINT_PATTERN.test(fingerprint) || !file) {
    throw new Error("Ungültige Upload-Metadaten.");
  }
  const expectedPathname = `lv-dokumente/${id}.${file.extension}`;
  if (pathname !== expectedPathname) throw new Error("Ungültiger Speicherpfad.");

  return {
    id,
    fileName,
    fingerprint,
    purpose,
    importedBy: "",
    pathname,
  };
}

async function inspectUpload(pathname: string): Promise<{
  prefix: Uint8Array;
  fingerprint: string;
  size: number;
  contentType: string;
}> {
  const object = await get(pathname, { access: "private", useCache: false });
  if (!object || object.statusCode !== 200) throw new Error("Upload nicht lesbar.");
  const bytes = new Uint8Array(await new Response(object.stream).arrayBuffer());
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const fingerprint = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return {
    prefix: bytes.subarray(0, 16),
    fingerprint,
    size: bytes.byteLength,
    contentType: object.blob.contentType,
  };
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as HandleUploadBody;
    const result = await handleUpload({
      request,
      body,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        const actor = await requireActor();
        const metadata = parseClientPayload(clientPayload, pathname);
        const file = supportedFile(metadata.fileName);
        if (!file) throw new Error("Nicht unterstützter Dateityp.");

        return {
          allowedContentTypes: [...file.allowedContentTypes],
          maximumSizeInBytes: MAX_FILE_SIZE,
          addRandomSuffix: false,
          allowOverwrite: false,
          tokenPayload: JSON.stringify({
            ...metadata,
            importedBy: actor.email || actor.userId,
          }),
        };
      },
      onUploadCompleted: async ({ blob, tokenPayload }) => {
        let metadata: UploadMetadata | null = null;
        try {
          metadata = JSON.parse(tokenPayload ?? "") as UploadMetadata;
          if (!metadata || blob.pathname !== metadata.pathname) {
            throw new Error("Upload-Pfad wurde verändert.");
          }
          const file = supportedFile(metadata.fileName);
          const inspection = await inspectUpload(blob.pathname);
          const metadataError = validateFileMetadata(
            metadata.fileName,
            inspection.size,
            inspection.contentType,
          );
          if (!file || metadataError) throw new Error(metadataError || "Ungültige Datei.");
          if (!hasExpectedMagic(metadata.fileName, inspection.prefix)) {
            throw new Error("Die Dateisignatur passt nicht zur Dateiendung.");
          }
          if (inspection.fingerprint !== metadata.fingerprint) {
            throw new Error("Die Dateiprüfsumme ist ungültig.");
          }

          await getDb().insert(storedDocuments).values({
            id: metadata.id,
            fileName: metadata.fileName,
            fileType: file.fileType,
            contentType: inspection.contentType,
            fileSize: inspection.size,
            fingerprint: metadata.fingerprint,
            storageKey: blob.pathname,
            purpose: metadata.purpose,
            status: "gespeichert",
            propertyManagement: "",
            positionCount: 0,
            reviewedAt: null,
            importedBy: metadata.importedBy,
          });
        } catch (error) {
          await del(blob.url).catch(() => undefined);
          if (isUniqueViolation(error)) return;
          throw error;
        }
      },
    });
    return Response.json(result);
  } catch (error) {
    return safeErrorResponse(error, "Datei konnte nicht sicher gespeichert werden.", 400);
  }
}
