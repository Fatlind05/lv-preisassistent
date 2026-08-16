import type {
  CatalogEntry,
  ParsedPosition,
  PositionMatch,
} from "./lv-types";
import { normalizeManagement } from "./lv-structure";

const STOP_WORDS = new Set([
  "der",
  "die",
  "das",
  "den",
  "dem",
  "des",
  "ein",
  "eine",
  "einer",
  "einem",
  "einen",
  "und",
  "oder",
  "sowie",
  "inkl",
  "inklusive",
  "einschliesslich",
  "fachgerecht",
  "gemaess",
  "nach",
  "vorhanden",
  "vorhandene",
  "bestehend",
  "bestehende",
  "ausfuehren",
  "herstellen",
]);

const WORD_REPLACEMENTS: Array<[RegExp, string]> = [
  [/\bwandflaechen?\b/g, "wand"],
  [/\bwaende\b/g, "wand"],
  [/\bdeckenflaechen?\b/g, "decke"],
  [/\btueren\b|\btuerblaetter\b|\btuerblatt\b/g, "tuer"],
  [/\banstriche?\b|\bbeschichtungen?\b|\bbeschichten\b/g, "streichen"],
  [/\bverspachteln\b|\bspachtelarbeiten\b/g, "spachteln"],
  [/\bgrundierungen?\b|\btiefgrund\b/g, "grundieren"],
  [/\bdispersionsanstrich\b/g, "dispersionsfarbe streichen"],
  [/\bkalk zement putz\b|\bkalkzementputz\b/g, "kalkzementputz"],
  [/\bweiss\b/g, "weiss"],
];

export function normalizeUnit(value: string): string {
  const unit = value
    .toLocaleLowerCase("de-DE")
    .trim()
    .replace(/\s+/g, "")
    .replace(/\//g, "")
    .replace(/²/g, "2")
    .replace(/\./g, "");
  if (["m2", "qm"].includes(unit)) return "m²";
  if (["mwo", "meterwoche", "meterwochen"].includes(unit)) return "mWo";
  if (["m2wo", "qmwo", "quadratmeterwoche", "quadratmeterwochen"].includes(unit)) return "m²Wo";
  if (["stk", "st", "stueck", "stück"].includes(unit)) return "Stk.";
  if (["stkw", "stueckwoche", "stueckwochen", "stückwoche", "stückwochen"].includes(unit)) return "StkW";
  if (["lfm", "laufendermeter", "laufendemeter"].includes(unit)) return "lfm";
  if (["lfmwo", "laufendermeterwoche", "laufendermeterwochen"].includes(unit)) return "lfm/Wo";
  if (["stgm", "steigmeter"].includes(unit)) return "Stgm";
  if (["std", "h", "stunde", "stunden"].includes(unit)) return "Std.";
  if (["psch", "paus", "pauschal", "pauschale"].includes(unit)) return "psch.";
  if (["d", "tag", "tage"].includes(unit)) return "d";
  if (["wo", "woche", "wochen"].includes(unit)) return "Wo";
  if (["l", "ltr", "liter"].includes(unit)) return "l";
  if (unit === "kg") return "kg";
  if (["m", "meter"].includes(unit)) return "m";
  return value.trim();
}

export function normalizeDescription(value: string): string {
  let normalized = value
    .toLocaleLowerCase("de-DE")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ß/g, "ss")
    .replace(/²/g, "2")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  for (const [pattern, replacement] of WORD_REPLACEMENTS) {
    normalized = normalized.replace(pattern, replacement);
  }

  return normalized
    .split(" ")
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token))
    .join(" ");
}

function tokenSet(value: string): Set<string> {
  return new Set(value.split(" ").filter(Boolean));
}

function characterBigrams(value: string): Set<string> {
  const compact = value.replace(/\s+/g, " ");
  const pairs = new Set<string>();
  for (let index = 0; index < compact.length - 1; index += 1) {
    pairs.add(compact.slice(index, index + 2));
  }
  return pairs;
}

function intersectionSize(left: Set<string>, right: Set<string>): number {
  let count = 0;
  for (const value of left) if (right.has(value)) count += 1;
  return count;
}

function similarity(left: string, right: string): number {
  if (!left || !right) return 0;
  if (left === right) return 1;

  const leftTokens = tokenSet(left);
  const rightTokens = tokenSet(right);
  const overlap = intersectionSize(leftTokens, rightTokens);
  if (!overlap) return 0;

  const coverage = overlap / Math.min(leftTokens.size, rightTokens.size);
  const jaccard = overlap / (leftTokens.size + rightTokens.size - overlap);
  const leftPairs = characterBigrams(left);
  const rightPairs = characterBigrams(right);
  const pairOverlap = intersectionSize(leftPairs, rightPairs);
  const dice =
    leftPairs.size + rightPairs.size > 0
      ? (2 * pairOverlap) / (leftPairs.size + rightPairs.size)
      : 0;

  return coverage * 0.5 + jaccard * 0.3 + dice * 0.2;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

type CatalogGroup = {
  normalizedDescription: string;
  propertyManagement: string;
  workCategory: CatalogEntry["workCategory"];
  prices: number[];
  sources: string[];
  tokens: Set<string>;
};

function buildGroups(entries: CatalogEntry[]): CatalogGroup[] {
  const groups = new Map<string, CatalogGroup>();

  for (const entry of entries) {
    const normalized =
      entry.normalizedDescription || normalizeDescription(entry.description);
    const propertyManagement = normalizeManagement(entry.propertyManagement || "");
    const workCategory = entry.workCategory || "sonstiges";
    const price = Number(entry.unitPrice);
    if (!normalized || !Number.isFinite(price) || price <= 0) continue;
    const key = `${workCategory}\u0000${propertyManagement}\u0000${normalized}`;
    const current = groups.get(key);
    if (current) {
      current.prices.push(price);
      current.sources.push(entry.sourceFileName);
    } else {
      groups.set(key, {
        normalizedDescription: normalized,
        propertyManagement,
        workCategory,
        prices: [price],
        sources: [entry.sourceFileName],
        tokens: tokenSet(normalized),
      });
    }
  }

  return [...groups.values()];
}

export function matchPositions(
  positions: ParsedPosition[],
  entries: CatalogEntry[],
): PositionMatch[] {
  const groups = buildGroups(entries);

  return positions.map((position) => {
    if (position.unitPrice && position.unitPrice > 0) {
      return {
        position,
        status: "existing",
        unitPrice: position.unitPrice,
        confidence: 1,
        sourceFileName: null,
        referenceCount: 0,
        reason: "Preis war bereits eingetragen",
      };
    }

    const normalized =
      position.normalizedDescription || normalizeDescription(position.description);
    const propertyManagement = normalizeManagement(position.propertyManagement || "");
    const tokens = tokenSet(normalized);
    let scopedGroups = groups;
    if (position.workCategory !== "sonstiges") {
      const sameCategory = scopedGroups.filter(
        (group) => group.workCategory === position.workCategory,
      );
      if (sameCategory.length) scopedGroups = sameCategory;
    }
    if (propertyManagement) {
      const sameManagement = scopedGroups.filter(
        (group) => group.propertyManagement === propertyManagement,
      );
      if (sameManagement.length) scopedGroups = sameManagement;
    }
    const candidates = scopedGroups.filter((group) => {
      const overlap = intersectionSize(tokens, group.tokens);
      const required = Math.min(2, Math.max(1, Math.min(tokens.size, group.tokens.size)));
      return overlap >= required;
    });

    const scored = candidates
      .map((group) => ({ group, score: similarity(normalized, group.normalizedDescription) }))
      .filter((candidate) => candidate.score > 0)
      .sort((left, right) => right.score - left.score);

    const best = scored[0];
    const second = scored[1];
    if (!best) {
      return {
        position,
        status: "open",
        unitPrice: null,
        confidence: 0,
        sourceFileName: null,
        referenceCount: 0,
        reason: "Keine passende Referenz gefunden",
      };
    }

    const price = median(best.group.prices);
    const minPrice = Math.min(...best.group.prices);
    const maxPrice = Math.max(...best.group.prices);
    const spread = price > 0 ? (maxPrice - minPrice) / price : 1;
    const gap = best.score - (second?.score ?? 0);
    const exact = best.score === 1;
    const safe =
      best.score >= 0.88 &&
      (exact || gap >= 0.06) &&
      spread <= 0.25;

    if (!safe) {
      return {
        position,
        status: "open",
        unitPrice: null,
        confidence: best.score,
        sourceFileName: best.group.sources[0] ?? null,
        referenceCount: best.group.prices.length,
        reason:
          spread > 0.25
            ? "Alte Preise weichen zu stark voneinander ab"
            : "Ähnlichkeit nicht eindeutig genug",
      };
    }

    return {
      position,
      status: "matched",
      unitPrice: Math.round(price * 100) / 100,
      confidence: best.score,
      sourceFileName: best.group.sources[0] ?? null,
      referenceCount: best.group.prices.length,
      reason: exact ? "Gleiche Leistungsbeschreibung – Einheit nicht bewertet" : "Sicherer ähnlicher Treffer – Einheit nicht bewertet",
    };
  });
}
