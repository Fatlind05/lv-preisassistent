import type { CellValue, Workbook, Worksheet } from "exceljs";
import { normalizeDescription, normalizeUnit } from "./lv-matcher";
import { classifyWorkCategory, detectPropertyManagement, WORK_CATEGORY_LABELS } from "./lv-structure";
import type { ParsedDocument, ParsedPosition, PositionMatch } from "./lv-types";

const MAX_FILE_SIZE = 25 * 1024 * 1024;
const SUMMARY_PATTERN = /^(netto|brutto|mwst|mehrwertsteuer|gesamt|summe|übertrag|uebertrag)\b/i;
const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp"]);

export type ParseProgress = (progress: number, label: string) => void;

type HeaderMap = {
  row: number;
  depth: number;
  position: number | null;
  description: number;
  quantity: number | null;
  unit: number | null;
  unitPrice: number | null;
  totalPrice: number | null;
};

function valueToText(value: CellValue): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number") return String(value).trim();
  if (typeof value === "boolean") return value ? "Ja" : "Nein";
  if (value instanceof Date) return value.toLocaleDateString("de-DE");
  if (typeof value === "object") {
    if ("result" in value && value.result !== undefined) {
      return valueToText(value.result as CellValue);
    }
    if ("richText" in value && Array.isArray(value.richText)) {
      return value.richText.map((part) => part.text).join("").trim();
    }
    if ("text" in value && typeof value.text === "string") return value.text.trim();
    if ("hyperlink" in value && "text" in value) return String(value.text).trim();
  }
  return "";
}

function parseNumber(value: CellValue | string | null): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const raw = typeof value === "string" ? value : valueToText(value as CellValue);
  if (!raw) return null;
  let cleaned = raw.replace(/[^0-9,.-]/g, "");
  if (!cleaned || cleaned === "-" || cleaned === "." || cleaned === ",") return null;

  if (cleaned.includes(",")) {
    cleaned = cleaned.replace(/\./g, "").replace(",", ".");
  } else {
    const dots = (cleaned.match(/\./g) ?? []).length;
    if (dots > 1) cleaned = cleaned.replace(/\./g, "");
  }
  const number = Number.parseFloat(cleaned);
  return Number.isFinite(number) ? number : null;
}

function normalizedHeader(value: string): string {
  return value
    .toLocaleLowerCase("de-DE")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function includesAny(value: string, terms: string[]): boolean {
  return terms.some((term) => value === term || value.includes(term));
}

function averageTextLength(sheet: Worksheet, column: number, startRow: number): number {
  let total = 0;
  let count = 0;
  const end = Math.min(sheet.rowCount, startRow + 12);
  for (let row = startRow; row <= end; row += 1) {
    const text = valueToText(sheet.getRow(row).getCell(column).value);
    if (text) {
      total += text.length;
      count += 1;
    }
  }
  return count ? total / count : 0;
}

function findHeaderMap(sheet: Worksheet): HeaderMap | null {
  const maxRows = Math.min(50, Math.max(sheet.rowCount, 1));
  const maxColumns = Math.min(60, Math.max(sheet.columnCount, 1));
  let best: { score: number; map: HeaderMap } | null = null;

  for (let row = 1; row <= maxRows; row += 1) {
    for (const depth of [1, 2]) {
      const labels: string[] = [];
      for (let column = 1; column <= maxColumns; column += 1) {
        const parts: string[] = [];
        for (let offset = 0; offset < depth; offset += 1) {
          parts.push(valueToText(sheet.getRow(row + offset).getCell(column).value));
        }
        labels[column] = normalizedHeader(parts.filter(Boolean).join(" "));
      }

      const descriptionCandidates: number[] = [];
      let position: number | null = null;
      let quantity: number | null = null;
      let unit: number | null = null;
      let unitPrice: number | null = null;
      let totalPrice: number | null = null;

      for (let column = 1; column <= maxColumns; column += 1) {
        const label = labels[column];
        if (!label) continue;
        if (
          includesAny(label, [
            "leistungsbeschreibung",
            "leistungstext",
            "beschreibung",
            "benennung",
            "kurztext",
            "langtext",
          ])
        ) {
          descriptionCandidates.push(column);
        }
        if (position === null && /^(pos|pos |position|oz)\b/.test(label)) position = column;
        if (
          quantity === null &&
          includesAny(label, ["menge", "aufmass", "aufmass menge", "vordersatz"])
        ) {
          quantity = column;
        }
        if (
          unit === null &&
          (label === "einheit" || label === "eh" || label === "me" || label === "mengeneinheit")
        ) {
          unit = column;
        }
        if (
          totalPrice === null &&
          includesAny(label, ["gesamtpreis", "gesamt preis", "gp", "betrag", "positionspreis"])
        ) {
          totalPrice = column;
        }
        if (
          unitPrice === null &&
          !includesAny(label, ["gesamtpreis", "gesamt preis", "betrag", "summe"]) &&
          (includesAny(label, ["einheitspreis", "einheits preis", "ep", "e preis"]) ||
            label === "preis")
        ) {
          unitPrice = column;
        }
      }

      if (!descriptionCandidates.length) continue;
      const dataStart = row + depth;
      const description = descriptionCandidates.sort(
        (left, right) =>
          averageTextLength(sheet, right, dataStart) -
          averageTextLength(sheet, left, dataStart),
      )[0];
      const score =
        4 +
        (unitPrice ? 3 : 0) +
        (quantity ? 1 : 0) +
        (unit ? 1 : 0) +
        (position ? 1 : 0) +
        (totalPrice ? 1 : 0);
      const map: HeaderMap = {
        row,
        depth,
        position,
        description,
        quantity,
        unit,
        unitPrice,
        totalPrice,
      };
      if (!best || score > best.score) best = { score, map };
    }
  }

  return best?.map ?? null;
}

async function parseExcel(file: File, asReference: boolean): Promise<ParsedDocument> {
  const excelModule = await import("exceljs");
  const ExcelJS = excelModule.default;
  const workbook = new ExcelJS.Workbook();
  const buffer = await file.arrayBuffer();
  await workbook.xlsx.load(buffer);
  const positions: ParsedPosition[] = [];
  const warnings: string[] = [];
  const documentText: string[] = [];

  for (const sheet of workbook.worksheets) {
    for (let rowNumber = 1; rowNumber <= Math.min(sheet.rowCount, 80); rowNumber += 1) {
      const parts: string[] = [];
      for (let column = 1; column <= Math.min(sheet.columnCount, 30); column += 1) {
        const text = valueToText(sheet.getRow(rowNumber).getCell(column).value);
        if (text) parts.push(text);
      }
      if (parts.length) documentText.push(parts.join(" "));
    }
    const map = findHeaderMap(sheet);
    if (!map) continue;
    if (asReference && !map.unitPrice) {
      warnings.push(`${sheet.name}: Keine Spalte „Einheitspreis“ erkannt.`);
      continue;
    }

    const startRow = map.row + map.depth;
    for (let rowNumber = startRow; rowNumber <= sheet.rowCount; rowNumber += 1) {
      const row = sheet.getRow(rowNumber);
      const description = valueToText(row.getCell(map.description).value)
        .replace(/\s+/g, " ")
        .trim();
      if (description.length < 3 || SUMMARY_PATTERN.test(description)) continue;

      const unitPrice = map.unitPrice
        ? parseNumber(row.getCell(map.unitPrice).value)
        : null;
      if (asReference && (!unitPrice || unitPrice <= 0)) continue;

      const positionCode = map.position
        ? valueToText(row.getCell(map.position).value)
        : "";
      const quantity = map.quantity
        ? parseNumber(row.getCell(map.quantity).value)
        : null;
      const unit = map.unit
        ? normalizeUnit(valueToText(row.getCell(map.unit).value))
        : "";
      const totalPrice = map.totalPrice
        ? parseNumber(row.getCell(map.totalPrice).value)
        : null;

      positions.push({
        id: `${sheet.name}-${rowNumber}`,
        positionCode,
        shortDescription: description,
        longDescription: "",
        description,
        normalizedDescription: normalizeDescription(description),
        propertyManagement: "",
        workCategory: classifyWorkCategory(description),
        quantity,
        unit,
        unitPrice,
        totalPrice,
        sheetName: sheet.name,
        rowNumber,
        priceColumn: map.unitPrice,
        totalColumn: map.totalPrice,
      });
    }
  }

  const propertyManagement = detectPropertyManagement(documentText.join("\n"));
  positions.forEach((position) => {
    position.propertyManagement = propertyManagement;
  });

  if (!positions.length) {
    warnings.push(
      asReference
        ? "Keine Zeilen mit Leistungsbeschreibung und Einheitspreis erkannt."
        : "Keine LV-Positionen erkannt. Prüfe bitte die Tabellenüberschriften.",
    );
  }

  return {
    fileName: file.name,
    kind: "xlsx",
    positions,
    propertyManagement,
    workbook,
    warnings,
  };
}

type PdfTextItem = {
  str?: string;
  transform?: number[];
};

type PdfLine = {
  text: string;
  x: number;
  y: number;
};

type PdfAnnotation = {
  rect?: number[];
  contents?: string;
  contentsObj?: { str?: string; html?: string };
  titleObj?: { str?: string; html?: string };
  alternativeText?: string;
  fieldName?: string;
  fieldValue?: string | string[];
  defaultFieldValue?: string | string[];
  richText?: string | { str?: string; html?: string };
  textContent?: string | string[];
};

function parsePdfLine(line: string, page: number, index: number, asReference: boolean): ParsedPosition | null {
  const unitPattern = /\b(m(?:²|2)?wo|m²|m2|qm|lfm|stk\.?|st\.?|stueck|stück|std\.?|h|stunden?|tage?|d|wochen?|wo|kg|ltr\.?|liter|l|psch\.?|pauschal|m(?!m))\b/i;
  const unitMatch = unitPattern.exec(line);
  if (!unitMatch || unitMatch.index < 2) return null;

  const beforeUnit = line.slice(0, unitMatch.index).trim();
  const afterUnit = line.slice(unitMatch.index + unitMatch[0].length).trim();
  const structuredPositionMatch = beforeUnit.match(/\b([0-9]{1,3}(?:\.[0-9]{1,3}){1,3})\b/);
  const leadingPositionMatch = beforeUnit.match(/^([0-9]+(?:[.\s][0-9]+)*)\s+/);
  const positionMatch = structuredPositionMatch ?? leadingPositionMatch;
  const positionCode = positionMatch?.[1]?.replace(/\s+/g, ".") ?? "";
  const withoutPosition = positionMatch
    ? beforeUnit.slice((positionMatch.index ?? 0) + positionMatch[0].length).trim()
    : beforeUnit;
  const quantityMatch = withoutPosition.match(/(-?[0-9.]+(?:,[0-9]+)?)\s*$/);
  const quantity = quantityMatch ? parseNumber(quantityMatch[1]) : null;
  const description = (quantityMatch
    ? withoutPosition.slice(0, quantityMatch.index).trim()
    : withoutPosition
  ).replace(/\s+/g, " ");
  if (description.length < 4 || SUMMARY_PATTERN.test(description)) return null;

  const priceStrings =
    afterUnit.match(/-?(?:[0-9]{1,3}(?:\.[0-9]{3})*|[0-9]+)[,.][0-9]{2}/g) ?? [];
  const unitPrice = priceStrings.length ? parseNumber(priceStrings[0]) : null;
  const totalPrice = priceStrings.length > 1 ? parseNumber(priceStrings[1]) : null;
  if (asReference && (!unitPrice || unitPrice <= 0)) return null;

  return {
    id: `Seite-${page}-${index}`,
    positionCode,
    shortDescription: description,
    longDescription: "",
    description,
    normalizedDescription: normalizeDescription(description),
    propertyManagement: "",
    workCategory: classifyWorkCategory(description),
    quantity,
    unit: normalizeUnit(unitMatch[0]),
    unitPrice,
    totalPrice,
    sheetName: `Seite ${page}`,
    rowNumber: index + 1,
    priceColumn: null,
    totalColumn: null,
  };
}

export function parseRecognizedText(text: string, asReference: boolean): ParsedPosition[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.replace(/[|¦]/g, " ").replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const positions: ParsedPosition[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    let position: ParsedPosition | null = null;
    let consumed = 1;

    for (const windowSize of [1, 2, 3]) {
      if (index + windowSize > lines.length) break;
      const candidate = lines.slice(index, index + windowSize).join(" ");
      position = parsePdfLine(candidate, 1, index, asReference);
      if (position) {
        consumed = windowSize;
        break;
      }
    }

    if (!position) continue;
    positions.push({
      ...position,
      id: `Foto-${index}`,
      sheetName: "Foto",
      rowNumber: index + 1,
    });
    index += consumed - 1;
  }

  return positions;
}

type OcrWord = {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  confidence: number;
};

type OcrPage = {
  width: number;
  height: number;
  words: OcrWord[];
};

const POSITION_CODE_PATTERN = /^\d{1,3}(?:[.,]\d{1,3}){2,3}$/;
const NUMBER_TOKEN_PATTERN = /^-?\d{1,9}(?:[.,]\d{1,3})?$/;

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function readOcrTsv(tsv: string | null): OcrPage {
  if (!tsv) return { width: 0, height: 0, words: [] };
  let width = 0;
  let height = 0;
  const words: OcrWord[] = [];

  for (const line of tsv.split(/\r?\n/)) {
    const fields = line.split("\t");
    if (fields.length < 12) continue;
    const level = Number(fields[0]);
    if (level === 1) {
      width = Number(fields[8]) || width;
      height = Number(fields[9]) || height;
      continue;
    }
    if (level !== 5) continue;
    const text = fields.slice(11).join("\t").trim();
    if (!text) continue;
    words.push({
      text,
      x: Number(fields[6]) || 0,
      y: Number(fields[7]) || 0,
      width: Number(fields[8]) || 0,
      height: Number(fields[9]) || 0,
      confidence: Number(fields[10]) || 0,
    });
  }

  return { width, height, words };
}

function cleanOcrToken(value: string): string {
  return value
    .replace(/[|¦_]/g, " ")
    .replace(/^[^\p{L}\p{N}².,-]+|[^\p{L}\p{N}².,-]+$/gu, "")
    .trim();
}

function recognizedUnit(value: string): string | null {
  const cleaned = cleanOcrToken(value)
    .toLocaleLowerCase("de-DE")
    .replace(/\./g, "")
    .replace(/²/g, "2");
  if (!cleaned) return null;
  if (/^m.*wo$/.test(cleaned)) return cleaned.includes("2") ? "m²Wo" : "mWo";
  if (["m2", "qm"].includes(cleaned)) return "m²";
  if (["m", "meter"].includes(cleaned)) return "m";
  if (["lfm"].includes(cleaned)) return "lfm";
  if (["st", "stk", "stueck", "stück"].includes(cleaned)) return "Stk.";
  if (["std", "h", "stunde", "stunden"].includes(cleaned)) return "Std.";
  if (["d", "tag", "tage"].includes(cleaned)) return "d";
  if (["wo", "woche", "wochen"].includes(cleaned)) return "Wo";
  if (["kg", "l", "ltr", "liter", "psch", "pauschal"].includes(cleaned)) {
    return normalizeUnit(cleaned);
  }
  return null;
}

function wordCenterY(word: OcrWord): number {
  return word.y + word.height / 2;
}

export function parseRecognizedTsv(tsv: string | null, asReference: boolean): ParsedPosition[] {
  const page = readOcrTsv(tsv);
  if (!page.words.length || !page.width) return [];
  const words = page.words.map((word) => ({ ...word, text: cleanOcrToken(word.text) }));
  const positionWords = words.filter((word) => POSITION_CODE_PATTERN.test(word.text));
  const descriptionHeader = words.find((word) =>
    /^(bezeichnung|beschreibung|leistungsbeschreibung)$/i.test(word.text),
  );
  const positionRight = positionWords.length
    ? median(positionWords.map((word) => word.x + word.width))
    : 0;
  const descriptionStart = descriptionHeader?.x ?? Math.max(page.width * 0.08, positionRight + page.width * 0.035);

  const quantityRows = words
    .filter((word) => NUMBER_TOKEN_PATTERN.test(word.text))
    .map((quantityWord) => {
      const rowTolerance = Math.max(22, quantityWord.height * 1.8);
      const unitWord = words
        .filter(
          (word) =>
            word.x >= quantityWord.x + quantityWord.width - 5 &&
            word.x - (quantityWord.x + quantityWord.width) < page.width * 0.13 &&
            Math.abs(wordCenterY(word) - wordCenterY(quantityWord)) <= rowTolerance &&
            recognizedUnit(word.text),
        )
        .sort(
          (left, right) =>
            Math.abs(wordCenterY(left) - wordCenterY(quantityWord)) -
              Math.abs(wordCenterY(right) - wordCenterY(quantityWord)) ||
            left.x - right.x,
        )[0];
      return unitWord
        ? { quantityWord, unitWord, unit: recognizedUnit(unitWord.text) as string }
        : null;
    })
    .filter((row): row is { quantityWord: OcrWord; unitWord: OcrWord; unit: string } => Boolean(row))
    .sort((left, right) => wordCenterY(left.quantityWord) - wordCenterY(right.quantityWord));

  const deduplicatedRows = quantityRows.filter((row, index) => {
    const previous = quantityRows[index - 1];
    if (!previous) return true;
    return (
      Math.abs(wordCenterY(row.quantityWord) - wordCenterY(previous.quantityWord)) > 5 ||
      Math.abs(row.quantityWord.x - previous.quantityWord.x) > 20
    );
  });
  const rowCenters = deduplicatedRows.map((row) => wordCenterY(row.quantityWord));
  const rowGaps = rowCenters
    .slice(1)
    .map((center, index) => center - rowCenters[index])
    .filter((gap) => gap > 8 && gap < page.height * 0.08);
  const rowSpacing = median(rowGaps) || Math.max(28, median(words.map((word) => word.height)) * 1.5);
  const positionOffsets = positionWords
    .map((positionWord) => {
      const positionCenter = wordCenterY(positionWord);
      const nearestRowCenter = [...rowCenters].sort(
        (left, right) => Math.abs(left - positionCenter) - Math.abs(right - positionCenter),
      )[0];
      return positionCenter - nearestRowCenter;
    })
    .filter((offset) => Math.abs(offset) <= rowSpacing * 0.8);
  const positionYOffset = median(positionOffsets);
  const positions: ParsedPosition[] = [];

  deduplicatedRows.forEach((row, index) => {
    const center = rowCenters[index];
    const start = index
      ? (rowCenters[index - 1] + center) / 2
      : center - rowSpacing / 2;
    const end = index < rowCenters.length - 1
      ? (center + rowCenters[index + 1]) / 2
      : center + rowSpacing / 2;
    const tolerance = Math.min(2, rowSpacing * 0.06);
    const expectedPositionCenter = center + positionYOffset;
    const positionWord = positionWords
      .filter(
        (word) =>
          Math.abs(wordCenterY(word) - expectedPositionCenter) <= Math.max(20, rowSpacing * 0.62),
      )
      .sort(
        (left, right) =>
          Math.abs(wordCenterY(left) - expectedPositionCenter) -
          Math.abs(wordCenterY(right) - expectedPositionCenter),
      )[0];
    const descriptionWords = words
      .filter((word) => {
        const wordCenter = wordCenterY(word);
        if (wordCenter < start - tolerance || wordCenter >= end + tolerance) return false;
        if (word.x < descriptionStart - page.width * 0.012) return false;
        if (word.x >= row.quantityWord.x - page.width * 0.01) return false;
        if (word.confidence < 12 || !word.text || POSITION_CODE_PATTERN.test(word.text)) return false;
        if (/^(n|t|ma|lfd|za|art-nr|menge|einheit|e-preis|g-preis)$/i.test(word.text)) return false;
        if (/^\d+$/.test(word.text)) return false;
        return true;
      })
      .sort((left, right) => left.x - right.x);
    const description = descriptionWords
      .map((word) => word.text)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    if (description.length < 4 || SUMMARY_PATTERN.test(description)) return;

    const priceWords = words
      .filter((word) => {
        const wordCenter = wordCenterY(word);
        return (
          wordCenter >= start - tolerance &&
          wordCenter < end + tolerance &&
          word.x > row.unitWord.x + row.unitWord.width &&
          /^-?\d{1,9}(?:[.,]\d{2})$/.test(word.text)
        );
      })
      .sort((left, right) => left.x - right.x);
    const unitPrice = priceWords[0] ? parseNumber(priceWords[0].text) : null;
    const totalPrice = priceWords[1] ? parseNumber(priceWords[1].text) : null;
    if (asReference && (!unitPrice || unitPrice <= 0)) return;

    positions.push({
      id: `Foto-Tabelle-${index}`,
      positionCode: positionWord?.text.replace(/,/g, ".") ?? "",
      shortDescription: description,
      longDescription: "",
      description,
      normalizedDescription: normalizeDescription(description),
      propertyManagement: "",
      workCategory: classifyWorkCategory(description),
      quantity: parseNumber(row.quantityWord.text),
      unit: row.unit,
      unitPrice,
      totalPrice,
      sheetName: "Foto",
      rowNumber: index + 1,
      priceColumn: null,
      totalColumn: null,
    });
  });

  return positions;
}

async function prepareOcrCanvas(file: File): Promise<HTMLCanvasElement> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("Das Bild konnte nicht geöffnet werden."));
      image.src = objectUrl;
    });
    const scale = Math.min(2, 3200 / image.naturalWidth, 3200 / image.naturalHeight);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("Das Bild konnte nicht vorbereitet werden.");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);

    const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
    const histogram = new Uint32Array(256);
    for (let index = 0; index < imageData.data.length; index += 4) {
      const gray = Math.round(
        imageData.data[index] * 0.299 +
          imageData.data[index + 1] * 0.587 +
          imageData.data[index + 2] * 0.114,
      );
      histogram[gray] += 1;
    }
    const totalPixels = canvas.width * canvas.height;
    const threshold = totalPixels * 0.01;
    let low = 0;
    let high = 255;
    let count = 0;
    while (low < 255 && count + histogram[low] < threshold) {
      count += histogram[low];
      low += 1;
    }
    count = 0;
    while (high > 0 && count + histogram[high] < threshold) {
      count += histogram[high];
      high -= 1;
    }
    const range = Math.max(1, high - low);
    const grayscale = new Uint8ClampedArray(totalPixels);
    for (let index = 0; index < imageData.data.length; index += 4) {
      const gray = Math.round(
        imageData.data[index] * 0.299 +
          imageData.data[index + 1] * 0.587 +
          imageData.data[index + 2] * 0.114,
      );
      const stretched = Math.max(0, Math.min(255, ((gray - low) * 255) / range));
      grayscale[index / 4] = stretched;
      imageData.data[index] = stretched;
      imageData.data[index + 1] = stretched;
      imageData.data[index + 2] = stretched;
    }
    for (let y = 1; y < canvas.height - 1; y += 1) {
      for (let x = 1; x < canvas.width - 1; x += 1) {
        const pixel = y * canvas.width + x;
        const center = grayscale[pixel];
        const neighborAverage =
          (grayscale[pixel - 1] +
            grayscale[pixel + 1] +
            grayscale[pixel - canvas.width] +
            grayscale[pixel + canvas.width]) /
          4;
        const sharpened = Math.max(0, Math.min(255, center + (center - neighborAverage) * 0.65));
        const dataIndex = pixel * 4;
        imageData.data[dataIndex] = sharpened;
        imageData.data[dataIndex + 1] = sharpened;
        imageData.data[dataIndex + 2] = sharpened;
      }
    }
    context.putImageData(imageData, 0, 0);
    return canvas;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function tableCropFromTsv(
  source: HTMLCanvasElement,
  tsv: string | null,
): HTMLCanvasElement | null {
  const page = readOcrTsv(tsv);
  const positionWords = page.words.filter((word) =>
    POSITION_CODE_PATTERN.test(cleanOcrToken(word.text)),
  );
  if (positionWords.length < 2) return null;
  const centers = positionWords.map(wordCenterY).sort((left, right) => left - right);
  const gaps = centers
    .slice(1)
    .map((center, index) => center - centers[index])
    .filter((gap) => gap > 8 && gap < source.height * 0.08);
  const rowSpacing = median(gaps) || source.height * 0.025;
  const top = Math.max(0, Math.floor(centers[0] - rowSpacing * 4));
  const bottom = Math.min(source.height, Math.ceil(centers[centers.length - 1] + rowSpacing * 4));
  const left = Math.floor(source.width * 0.035);
  const right = Math.ceil(source.width * 0.97);
  if (bottom - top < 120) return null;

  const crop = document.createElement("canvas");
  crop.width = right - left;
  crop.height = bottom - top;
  const context = crop.getContext("2d");
  if (!context) return null;
  context.drawImage(source, left, top, crop.width, crop.height, 0, 0, crop.width, crop.height);
  return crop;
}

function imageProgress(
  status: string,
  progress: number,
  recognitionPass: number,
): { value: number; label: string } {
  const bounded = Math.max(0, Math.min(1, progress));
  const normalized = status.toLocaleLowerCase("de-DE");
  if (normalized.includes("loading tesseract core")) {
    return { value: 0.05 + bounded * 0.1, label: "Texterkennung wird vorbereitet" };
  }
  if (normalized.includes("initializing tesseract")) {
    return { value: 0.15 + bounded * 0.1, label: "Texterkennung wird gestartet" };
  }
  if (normalized.includes("loading language")) {
    return { value: 0.25 + bounded * 0.2, label: "Deutsche Sprache wird geladen" };
  }
  if (normalized.includes("initializing api")) {
    return { value: 0.45 + bounded * 0.1, label: "Foto wird vorbereitet" };
  }
  if (normalized.includes("recognizing text")) {
    const base = recognitionPass > 1 ? 0.76 : 0.53;
    const span = recognitionPass > 1 ? 0.22 : 0.22;
    return { value: base + bounded * span, label: "LV-Tabelle im Foto wird erkannt" };
  }
  return { value: 0.05 + bounded * 0.9, label: "Foto wird gelesen" };
}

async function parseImage(
  file: File,
  asReference: boolean,
  onProgress?: ParseProgress,
): Promise<ParsedDocument> {
  onProgress?.(0.02, "Foto wird vorbereitet");
  const canvas = await prepareOcrCanvas(file);
  const { createWorker, PSM } = await import("tesseract.js");
  let recognitionPass = 0;
  const worker = await createWorker("deu", 1, {
    workerPath: "/tesseract/worker.min.js",
    corePath: "/tesseract/core",
    langPath: "/tesseract/lang",
    gzip: true,
    logger: (message) => {
      const update = imageProgress(message.status, message.progress, recognitionPass);
      onProgress?.(update.value, update.label);
    },
  });

  try {
    await worker.setParameters({
      tessedit_pageseg_mode: PSM.SPARSE_TEXT,
      preserve_interword_spaces: "1",
      user_defined_dpi: "300",
    });
    recognitionPass = 1;
    const result = await worker.recognize(canvas, { rotateAuto: true }, { text: true, tsv: true });
    const fullPositions = parseRecognizedTsv(result.data.tsv, asReference);
    const crop = tableCropFromTsv(canvas, result.data.tsv);
    let cropPositions: ParsedPosition[] = [];
    let cropConfidence = result.data.confidence;
    if (crop) {
      recognitionPass = 2;
      const cropResult = await worker.recognize(crop, {}, { text: true, tsv: true });
      cropPositions = parseRecognizedTsv(cropResult.data.tsv, asReference);
      cropConfidence = cropResult.data.confidence;
    }
    const coordinatePositions =
      cropPositions.length >= fullPositions.length ? cropPositions : fullPositions;
    const positions = coordinatePositions.length
      ? coordinatePositions
      : parseRecognizedText(result.data.text, asReference);
    const propertyManagement = detectPropertyManagement(result.data.text);
    positions.forEach((position) => {
      position.propertyManagement = propertyManagement;
    });
    const warnings: string[] = [];

    if (positions.length) {
      warnings.push(
        "Das Foto wurde per Texterkennung gelesen; die Ausgabe erfolgt als neue Excel-Datei.",
      );
    } else {
      warnings.push(
        asReference
          ? "Im Foto wurde keine eindeutige Preiszeile erkannt. Fotografiere die ganze Tabelle gerade und scharf."
          : "Im Foto wurde keine eindeutige LV-Position erkannt. Fotografiere die ganze Tabelle gerade und scharf.",
      );
    }
    if (Math.max(result.data.confidence, cropConfidence) < 45) {
      warnings.push("Die Bildqualität ist niedrig. Ein gerades, scharfes Foto liefert bessere Treffer.");
    }
    onProgress?.(1, "Foto wurde gelesen");

    return {
      fileName: file.name,
      kind: "image",
      positions,
      propertyManagement,
      workbook: null,
      warnings,
    };
  } finally {
    await worker.terminate();
  }
}

async function parsePdf(file: File, asReference: boolean): Promise<ParsedDocument> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const worker = await import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url");
  if (typeof worker.default === "string") {
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjs.getDocument({ data: bytes }).promise;
  const positions: ParsedPosition[] = [];
  const documentText: string[] = [];
  const longTextPositionIds = new Set<string>();

  function cleanPdfText(value: string): string {
    return value
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;|&#160;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&quot;/gi, '"')
      .replace(/&#39;|&apos;/gi, "'")
      .replace(/\s+/g, " ")
      .trim();
  }

  function textFromPdfValue(value: unknown): string[] {
    if (typeof value === "string") return [cleanPdfText(value)].filter(Boolean);
    if (Array.isArray(value)) return value.flatMap((part) => textFromPdfValue(part));
    if (!value || typeof value !== "object") return [];
    const record = value as Record<string, unknown>;
    return [record.str, record.html, record.text, record.value].flatMap((part) =>
      textFromPdfValue(part),
    );
  }

  function annotationText(annotation: PdfAnnotation): string {
    const values = [
      annotation.contentsObj,
      annotation.contents,
      annotation.richText,
      annotation.fieldValue,
      annotation.defaultFieldValue,
      annotation.textContent,
    ];
    const content = values.flatMap((value) => textFromPdfValue(value));
    const fallback = textFromPdfValue(annotation.alternativeText);
    return [...new Set(content.length ? content : fallback)].join(" ");
  }

  function annotationContext(annotation: PdfAnnotation, text: string): string {
    return [
      text,
      annotation.fieldName,
      annotation.alternativeText,
      ...textFromPdfValue(annotation.titleObj),
    ]
      .filter((value): value is string => typeof value === "string" && Boolean(value.trim()))
      .join(" ");
  }

  function cleanLongText(value: string): string {
    return cleanPdfText(value)
      .replace(/^(?:langtext|leistungsbeschreibung|ausf(?:ü|ue)hrliche beschreibung)\s*[:\-–]?\s*/i, "")
      .trim();
  }

  function usableLongText(value: string): boolean {
    if (value.length < 5 || SUMMARY_PATTERN.test(value)) return false;
    return !/^(seite\s+\d+|pos(?:ition)?\.?|kurztext|langtext|leistungsbeschreibung|bezeichnung|menge|einheit|e-?preis|g-?preis|gesamtpreis)\s*[:\-–]?\s*$/i.test(
      value,
    );
  }

  function mentionsPositionCode(value: string, positionCode: string): boolean {
    const codeParts = positionCode.split(/[^0-9a-z]+/i).filter(Boolean);
    if (!codeParts.length) return false;
    const pattern = codeParts
      .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("[.\\s/_-]*");
    return new RegExp(`(^|[^0-9a-z])${pattern}(?=$|[^0-9a-z])`, "i").test(value);
  }

  function attachLongText(position: ParsedPosition, parts: string[]): void {
    const unique: string[] = [];
    const seen = new Set<string>();
    for (const rawPart of parts) {
      const part = cleanLongText(rawPart);
      const key = normalizeDescription(part);
      if (!usableLongText(part) || !key || seen.has(key)) continue;
      if (normalizeDescription(position.shortDescription).includes(key)) continue;
      seen.add(key);
      unique.push(part);
    }
    if (!unique.length) return;
    position.longDescription = unique.join(" ");
    position.description = `${position.shortDescription} ${position.longDescription}`.trim();
    position.normalizedDescription = normalizeDescription(position.description);
    position.workCategory = classifyWorkCategory(position.description);
    longTextPositionIds.add(position.id);
  }

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const [content, rawAnnotations] = await Promise.all([
      page.getTextContent({ includeMarkedContent: true }),
      page.getAnnotations({ intent: "any" }),
    ]);
    const buckets = new Map<number, Array<{ x: number; text: string }>>();

    for (const rawItem of content.items as PdfTextItem[]) {
      const text = rawItem.str?.trim();
      const transform = rawItem.transform;
      if (!text || !transform || transform.length < 6) continue;
      const x = transform[4] ?? 0;
      const y = transform[5] ?? 0;
      const key = Math.round(y / 3) * 3;
      const items = buckets.get(key) ?? [];
      items.push({ x, text });
      buckets.set(key, items);
    }

    const lines: PdfLine[] = [...buckets.entries()]
      .sort((left, right) => right[0] - left[0])
      .map(([y, items]) => {
        const sortedItems = items.sort((left, right) => left.x - right.x);
        return {
          y,
          x: sortedItems[0]?.x ?? 0,
          text: sortedItems
          .sort((left, right) => left.x - right.x)
          .map((item) => item.text)
          .join(" ")
          .replace(/\s+/g, " ")
          .trim(),
        };
      });
    documentText.push(...lines.map((line) => line.text));

    const pagePositions: Array<{ position: ParsedPosition; lineIndex: number; x: number; y: number }> = [];
    lines.forEach((line, index) => {
      const position = parsePdfLine(line.text, pageNumber, index, asReference);
      if (!position) return;
      pagePositions.push({ position, lineIndex: index, x: line.x, y: line.y });
    });

    pagePositions.forEach((record, positionIndex) => {
      const nextLineIndex = pagePositions[positionIndex + 1]?.lineIndex ?? lines.length;
      const parts: string[] = [];
      let previousY = record.y;
      for (
        let lineIndex = record.lineIndex + 1;
        lineIndex < nextLineIndex && parts.length < 40;
        lineIndex += 1
      ) {
        const line = lines[lineIndex];
        const verticalGap = previousY - line.y;
        if (verticalGap > 48) break;
        previousY = line.y;
        if (line.x < record.x + 8 || !usableLongText(line.text)) continue;
        parts.push(line.text);
      }
      attachLongText(record.position, parts);
    });

    const annotations = rawAnnotations as PdfAnnotation[];
    for (const annotation of annotations) {
      const text = annotationText(annotation);
      if (!usableLongText(text) || !pagePositions.length) continue;
      documentText.push(text);
      const context = annotationContext(annotation, text);
      const mentioned = pagePositions.find(
        ({ position }) =>
          position.positionCode && mentionsPositionCode(context, position.positionCode),
      );
      const annotationY = annotation.rect?.length === 4
        ? ((annotation.rect[1] ?? 0) + (annotation.rect[3] ?? 0)) / 2
        : null;
      const nearest = annotationY === null
        ? null
        : [...pagePositions].sort(
            (left, right) => Math.abs(left.y - annotationY) - Math.abs(right.y - annotationY),
          )[0];
      const pageHeight = Math.abs((page.view?.[3] ?? 0) - (page.view?.[1] ?? 0));
      const nearestIsSafe = Boolean(
        nearest && annotationY !== null &&
        Math.abs(nearest.y - annotationY) <= Math.max(72, pageHeight * 0.08),
      );
      const target = mentioned ?? (nearestIsSafe ? nearest : null) ??
        (pagePositions.length === 1 ? pagePositions[0] : null);
      if (!target) continue;
      attachLongText(target.position, [target.position.longDescription, text]);
    }

    positions.push(...pagePositions.map(({ position }) => position));
  }

  const propertyManagement = detectPropertyManagement(documentText.join("\n"));
  positions.forEach((position) => {
    position.propertyManagement = propertyManagement;
  });

  return {
    fileName: file.name,
    kind: "pdf",
    positions,
    propertyManagement,
    workbook: null,
    warnings: positions.length
      ? [
          "PDF-Positionen werden erkannt; die Ausgabe erfolgt als neue Excel-Datei.",
          longTextPositionIds.size
            ? `${longTextPositionIds.size} Positionen enthalten ausgelesenen Langtext aus PDF-Text oder eingebetteten PDF-Feldern.`
            : "Kein Langtext in der PDF-Datei gefunden. Wenn er im Ausgangsprogramm nur beim Anklicken erscheint, muss er beim PDF-Export mitgespeichert werden.",
        ]
      : ["In diesem PDF wurde keine eindeutige LV-Tabelle erkannt."],
  };
}

export async function parseLvFile(
  file: File,
  asReference: boolean,
  onProgress?: ParseProgress,
): Promise<ParsedDocument> {
  if (file.size > MAX_FILE_SIZE) {
    throw new Error(`${file.name}: Datei ist größer als 25 MB.`);
  }
  const extension = file.name.split(".").pop()?.toLocaleLowerCase("de-DE");
  if (extension === "xlsx") return parseExcel(file, asReference);
  if (extension === "pdf") return parsePdf(file, asReference);
  if (extension && IMAGE_EXTENSIONS.has(extension)) {
    return parseImage(file, asReference, onProgress);
  }
  throw new Error(
    `${file.name}: Unterstützt werden Excel (.xlsx), PDF und Fotos (.jpg, .png, .webp).`,
  );
}

export async function fingerprintFile(file: File): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

function outputName(fileName: string): string {
  const base = fileName.replace(/\.(xlsx|pdf|jpe?g|png|webp)$/i, "");
  return `${base}_ausgefuellt.xlsx`;
}

export async function downloadMatchedDocument(
  document: ParsedDocument,
  matches: PositionMatch[],
): Promise<void> {
  const excelModule = await import("exceljs");
  const ExcelJS = excelModule.default;
  let workbook: Workbook;

  if (document.kind === "xlsx" && document.workbook) {
    workbook = document.workbook;
    workbook.calcProperties.fullCalcOnLoad = true;
    for (const match of matches) {
      if (match.status !== "matched" || match.unitPrice === null) continue;
      const position = match.position;
      if (!position.priceColumn) continue;
      const sheet = workbook.getWorksheet(position.sheetName);
      if (!sheet) continue;
      const priceCell = sheet.getRow(position.rowNumber).getCell(position.priceColumn);
      priceCell.value = match.unitPrice;
      priceCell.numFmt = '#,##0.00 [$€-407]';
      priceCell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFE2F0D9" },
      };
    }
  } else {
    workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Ausgefülltes LV", {
      views: [{ state: "frozen", ySplit: 1 }],
    });
    sheet.columns = [
      { header: "Hausverwaltung / Kunde", key: "propertyManagement", width: 28 },
      { header: "Arbeitsbereich", key: "workCategory", width: 18 },
      { header: "Pos.", key: "position", width: 14 },
      { header: "Kurztext", key: "shortDescription", width: 45 },
      { header: "Langtext", key: "longDescription", width: 70 },
      { header: "Menge", key: "quantity", width: 14 },
      { header: "Einheit", key: "unit", width: 12 },
      { header: "E-Preis", key: "unitPrice", width: 18 },
      { header: "Gesamtpreis", key: "totalPrice", width: 18 },
      { header: "Status", key: "status", width: 22 },
      { header: "Quelle", key: "source", width: 34 },
    ];
    const header = sheet.getRow(1);
    header.font = { bold: true, color: { argb: "FFFFFFFF" } };
    header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF173B57" } };
    header.height = 28;

    for (const match of matches) {
      const price = match.status === "matched" ? match.unitPrice : match.position.unitPrice;
      const row = sheet.addRow({
        propertyManagement: match.position.propertyManagement,
        workCategory: WORK_CATEGORY_LABELS[match.position.workCategory],
        position: match.position.positionCode,
        shortDescription: match.position.shortDescription || match.position.description,
        longDescription: match.position.longDescription,
        quantity: match.position.quantity,
        unit: match.position.unit,
        unitPrice: price,
        totalPrice: null,
        status:
          match.status === "matched"
            ? "Sicher übernommen"
            : match.status === "existing"
              ? "Bereits vorhanden"
              : "Offen – bitte prüfen",
        source: match.sourceFileName ?? "",
      });
      row.getCell(9).value = {
        formula: `IF(AND(ISNUMBER(F${row.number}),ISNUMBER(H${row.number})),F${row.number}*H${row.number},"")`,
      };
      row.alignment = { vertical: "top", wrapText: true };
      if (match.status === "matched") {
        row.getCell(8).fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FFE2F0D9" },
        };
      }
    }
    sheet.getColumn(8).numFmt = '#,##0.00 [$€-407]';
    sheet.getColumn(9).numFmt = '#,##0.00 [$€-407]';
    sheet.autoFilter = "A1:K1";
  }

  workbook.creator = "LV Preisassistent";
  workbook.modified = new Date();
  const output = await workbook.xlsx.writeBuffer();
  downloadBlob(
    new Blob([output], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
    outputName(document.fileName),
  );
}
