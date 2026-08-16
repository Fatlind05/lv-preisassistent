import { describe, expect, it } from "vitest";
import { matchPositions, normalizeDescription } from "../app/lib/lv-matcher";
import type { CatalogEntry, ParsedPosition } from "../app/lib/lv-types";

function position(overrides: Partial<ParsedPosition> = {}): ParsedPosition {
  const description = overrides.description ?? "Wandflächen zweimal mit Dispersionsfarbe streichen";
  return {
    id: "position-1",
    positionCode: "01.01",
    shortDescription: description,
    longDescription: "",
    description,
    normalizedDescription: normalizeDescription(description),
    propertyManagement: "Verwaltung Nord",
    workCategory: "innen",
    quantity: 10,
    unit: "m²",
    unitPrice: null,
    totalPrice: null,
    sheetName: "LV",
    rowNumber: 5,
    priceColumn: 7,
    totalColumn: 8,
    ...overrides,
  };
}

function entry(price: number, overrides: Partial<CatalogEntry> = {}): CatalogEntry {
  const description = overrides.description ?? "Wandflächen zweimal mit Dispersionsfarbe streichen";
  return {
    id: crypto.randomUUID(),
    description,
    shortDescription: description,
    longDescription: "",
    normalizedDescription: normalizeDescription(description),
    propertyManagement: "Verwaltung Nord",
    workCategory: "innen",
    unit: "m²",
    unitPrice: price,
    sourceFileName: "alt.xlsx",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("LV matcher", () => {
  it("keeps a price that is already present", () => {
    const result = matchPositions([position({ unitPrice: 18.5 })], [entry(12)])[0];
    expect(result.status).toBe("existing");
    expect(result.unitPrice).toBe(18.5);
  });

  it("uses the median for a safe exact description match", () => {
    const result = matchPositions(
      [position({ unit: "Stk." })],
      [entry(10), entry(12, { sourceFileName: "alt-2.xlsx" })],
    )[0];
    expect(result.status).toBe("matched");
    expect(result.unitPrice).toBe(11);
    expect(result.reason).toContain("Einheit nicht bewertet");
  });

  it("leaves volatile historic prices open", () => {
    const result = matchPositions([position()], [entry(10), entry(20)])[0];
    expect(result.status).toBe("open");
    expect(result.unitPrice).toBeNull();
    expect(result.reason).toMatch(/weichen zu stark/);
  });

  it("does not guess when no reference overlaps", () => {
    const result = matchPositions(
      [position({ description: "Gerüst vorhalten", normalizedDescription: "geruest vorhalten" })],
      [entry(12)],
    )[0];
    expect(result.status).toBe("open");
    expect(result.confidence).toBe(0);
  });
});
