import { count, desc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { priceEntries, referenceFiles } from "../../../db/schema";

type ImportedPosition = {
  positionCode?: string | null;
  shortDescription?: string;
  longDescription?: string;
  description?: string;
  normalizedDescription?: string;
  workCategory?: string;
  unit?: string;
  unitPrice?: number;
  sourceSheet?: string | null;
  sourceRow?: number | null;
};

type ImportPayload = {
  fileName?: string;
  fileType?: string;
  fingerprint?: string;
  propertyManagement?: string;
  positions?: ImportedPosition[];
};

const MAX_POSITIONS_PER_FILE = 5_000;

function textValue(value: unknown, max = 500): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function fallbackNormalize(value: string): string {
  return value
    .toLocaleLowerCase("de-DE")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function routeMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "Unbekannter Fehler";
  if (message.includes("no such table")) {
    return "Die Preisbibliothek wird gerade vorbereitet. Bitte gleich erneut versuchen.";
  }
  return message;
}

export async function GET() {
  try {
    const db = await getDb();
    const [fileCountRows, priceCountRows, recentFiles, rows] = await Promise.all([
      db.select({ value: count() }).from(referenceFiles),
      db.select({ value: count() }).from(priceEntries),
      db
        .select({
          id: referenceFiles.id,
          fileName: referenceFiles.fileName,
          fileType: referenceFiles.fileType,
          fingerprint: referenceFiles.fingerprint,
          propertyManagement: referenceFiles.propertyManagement,
          positionCount: referenceFiles.positionCount,
          importedBy: referenceFiles.importedBy,
          createdAt: referenceFiles.createdAt,
        })
        .from(referenceFiles)
        .orderBy(desc(referenceFiles.createdAt))
        .limit(500),
      db
        .select({
          id: priceEntries.id,
          description: priceEntries.description,
          shortDescription: priceEntries.shortDescription,
          longDescription: priceEntries.longDescription,
          normalizedDescription: priceEntries.normalizedDescription,
          propertyManagement: referenceFiles.propertyManagement,
          workCategory: priceEntries.workCategory,
          unit: priceEntries.unit,
          unitPrice: priceEntries.unitPrice,
          sourceFileName: referenceFiles.fileName,
          createdAt: priceEntries.createdAt,
        })
        .from(priceEntries)
        .innerJoin(
          referenceFiles,
          eq(priceEntries.referenceFileId, referenceFiles.id),
        )
        .orderBy(desc(priceEntries.createdAt))
        .limit(20_000),
    ]);

    return Response.json({
      stats: {
        referenceFiles: Number(fileCountRows[0]?.value ?? 0),
        priceEntries: Number(priceCountRows[0]?.value ?? 0),
        lastImportAt: recentFiles[0]?.createdAt ?? null,
      },
      recentFiles,
      entries: rows,
    });
  } catch (error) {
    return Response.json({ error: routeMessage(error) }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const db = await getDb();
  let referenceId: string | null = null;

  try {
    const payload = (await request.json()) as ImportPayload;
    const fileName = textValue(payload.fileName, 240);
    const fileType = textValue(payload.fileType, 24).toLowerCase();
    const fingerprint = textValue(payload.fingerprint, 128);
    const propertyManagement = textValue(payload.propertyManagement, 160);
    const rawPositions = Array.isArray(payload.positions) ? payload.positions : [];

    if (!fileName || !fingerprint) {
      return Response.json(
        { error: "Dateiname oder Dateiprüfsumme fehlt." },
        { status: 400 },
      );
    }
    if (!rawPositions.length || rawPositions.length > MAX_POSITIONS_PER_FILE) {
      return Response.json(
        { error: "Keine gültigen Preispositionen gefunden oder Dateilimit überschritten." },
        { status: 400 },
      );
    }

    const existing = await db
      .select({ id: referenceFiles.id, positionCount: referenceFiles.positionCount })
      .from(referenceFiles)
      .where(eq(referenceFiles.fingerprint, fingerprint))
      .limit(1);
    if (existing[0]) {
      return Response.json({
        duplicate: true,
        imported: existing[0].positionCount,
      });
    }

    const positions = rawPositions
      .map((position) => {
        const description = textValue(position.description, 6_000);
        const shortDescription = textValue(position.shortDescription, 1_000) || description;
        const longDescription = textValue(position.longDescription, 4_000);
        const normalized =
          textValue(position.normalizedDescription, 6_000) ||
          fallbackNormalize(description);
        const unitPrice = Number(position.unitPrice);
        return {
          positionCode: textValue(position.positionCode, 80) || null,
          shortDescription,
          longDescription,
          description,
          normalizedDescription: normalized,
          workCategory: ["geruest", "innen", "aussen", "sonstiges"].includes(
            textValue(position.workCategory, 24),
          )
            ? textValue(position.workCategory, 24)
            : "sonstiges",
          unit: textValue(position.unit, 40),
          unitPrice,
          sourceSheet: textValue(position.sourceSheet, 160) || null,
          sourceRow:
            Number.isInteger(position.sourceRow) && Number(position.sourceRow) > 0
              ? Number(position.sourceRow)
              : null,
        };
      })
      .filter(
        (position) =>
          position.description.length >= 3 &&
          position.normalizedDescription.length >= 2 &&
          Number.isFinite(position.unitPrice) &&
          position.unitPrice > 0 &&
          position.unitPrice < 1_000_000,
      );

    if (!positions.length) {
      return Response.json(
        { error: "In der Datei wurden keine verwendbaren Einheitspreise erkannt." },
        { status: 400 },
      );
    }

    referenceId = crypto.randomUUID();
    const importedBy =
      request.headers.get("oai-authenticated-user-email")?.slice(0, 240) ?? null;

    await db.insert(referenceFiles).values({
      id: referenceId,
      fileName,
      fileType: fileType || "unbekannt",
      fingerprint,
      propertyManagement,
      positionCount: positions.length,
      importedBy,
    });

    for (let index = 0; index < positions.length; index += 10) {
      const chunk = positions.slice(index, index + 10).map((position) => ({
        id: crypto.randomUUID(),
        referenceFileId: referenceId as string,
        ...position,
      }));
      await db.insert(priceEntries).values(chunk);
    }

    return Response.json({
      duplicate: false,
      imported: positions.length,
      referenceId,
    });
  } catch (error) {
    if (referenceId) {
      try {
        await db
          .delete(priceEntries)
          .where(eq(priceEntries.referenceFileId, referenceId));
        await db.delete(referenceFiles).where(eq(referenceFiles.id, referenceId));
      } catch {
        // Die ursprüngliche Fehlermeldung bleibt maßgeblich.
      }
    }
    return Response.json({ error: routeMessage(error) }, { status: 500 });
  }
}
