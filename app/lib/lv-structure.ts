import type { WorkCategory } from "./lv-types";

const CATEGORY_PATTERNS: Array<{ category: WorkCategory; pattern: RegExp }> = [
  {
    category: "geruest",
    pattern:
      /\b(geruest|gerüst|fassadengeruest|fassadengerüst|schutzgeruest|schutzgerüst|arbeitsgeruest|arbeitsgerüst|fahrgeruest|fahrgerüst|hubbuehne|hubbühne|arbeitsbuehne|arbeitsbühne|treppenaufstiegsturm)\b/i,
  },
  {
    category: "aussen",
    pattern:
      /\b(aussen|außen|aussenarbeit|außenarbeit|aussenbereich|außenbereich|fassade|fassadenflaeche|fassadenfläche|aussenwand|außenwand|sockel|balkon|dachueberstand|dachüberstand|fenster.*aussen|fenster.*außen)\b/i,
  },
  {
    category: "innen",
    pattern:
      /\b(innen|innenarbeit|innenbereich|innenraum|wohnung|treppenhaus|zimmer|flur|innenwand|decke|tapete|heizkoerper|heizkörper|tuerblatt|türblatt)\b/i,
  },
];

export const WORK_CATEGORY_LABELS: Record<WorkCategory, string> = {
  geruest: "Gerüst",
  innen: "Innenarbeit",
  aussen: "Außenarbeit",
  sonstiges: "Sonstiges / offen",
};

export function classifyWorkCategory(text: string): WorkCategory {
  const normalized = text
    .toLocaleLowerCase("de-DE")
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ß/g, "ss");
  return CATEGORY_PATTERNS.find(({ pattern }) => pattern.test(normalized))?.category ?? "sonstiges";
}

function cleanManagementName(value: string): string {
  return value
    .replace(/\s{2,}/g, " ")
    .replace(/\b(?:objekt|bauvorhaben|projekt|angebot|leistungsverzeichnis|lv)\b.*$/i, "")
    .replace(/^[\s:;,.\-–—]+|[\s:;,.\-–—]+$/g, "")
    .trim()
    .slice(0, 120);
}

export function detectPropertyManagement(text: string): string {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const patterns = [
    /\b(?:hausverwaltung|immobilienverwaltung|verwalter(?:in)?)\s*[:\-–—]?\s*(.{3,140})$/i,
    /\b(?:verwaltung)\s*[:\-–—]\s*(.{3,140})$/i,
    /\b(?:kunde|auftraggeber|bauherr)\s*[:\-–—]?\s*(.{3,140})$/i,
  ];

  for (const pattern of patterns) {
    for (const line of lines.slice(0, 120)) {
      const match = pattern.exec(line);
      if (!match?.[1]) continue;
      const name = cleanManagementName(match[1]);
      if (name.length >= 3) return name;
    }
  }
  return "";
}

export function normalizeManagement(value: string): string {
  return value
    .toLocaleLowerCase("de-DE")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ß/g, "ss")
    .replace(/\b(gmbh|mbh|kg|ag|hausverwaltung|immobilienverwaltung|verwaltung)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
