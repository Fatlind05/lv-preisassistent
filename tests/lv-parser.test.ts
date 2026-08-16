import { describe, expect, it } from "vitest";
import { normalizeUnit } from "../app/lib/lv-matcher";
import { parseRecognizedText } from "../app/lib/lv-parser";

describe("PDF LV parser", () => {
  it("combines multiline positions and normalizes spaced position codes", () => {
    const positions = parseRecognizedText(
      [
        "Pos-Nr Bezeichnung Menge Einheit E-Preis G-Preis",
        "01.01. . 1 Baustelleneinrichtung einschließlich aller",
        "für die vertragsgemäße Erfüllung notwendigen Leistungen",
        "1,000 paus 3.000,00 3.000,00",
        "01.01. . 2 Baustromanschluss einrichten",
        "1,000 psch 400,00 400,00",
      ].join("\n"),
      true,
    );

    expect(positions).toHaveLength(2);
    expect(positions[0]).toMatchObject({
      positionCode: "01.01.1",
      unit: "psch.",
      unitPrice: 3000,
      totalPrice: 3000,
    });
    expect(positions[0].description).toContain("vertragsgemäße Erfüllung");
  });

  it("uses EP instead of LV quantity when both columns are present", () => {
    const positions = parseRecognizedText(
      [
        "Pos. Bezeichnung/Aufmass Menge/n ME LV-Menge EP GP GP LV",
        "1.01.1 Baustelleneinrichtung Geräte, Werkzeuge 1,00 psch 1,00 4.200,00 € 4.200,00 € 4.200,00 €",
        "1.01.2",
        "Baustromanschluss einrichten 1,00 psch 1,00 400,00 € 400,00 € 400,00 €",
        "1.01.5 WC-Kleinkabine vorhalten Stück/ 6,00 48,00 € 288,00 €",
      ].join("\n"),
      true,
    );

    expect(positions).toHaveLength(3);
    expect(positions[0]).toMatchObject({ quantity: 1, unitPrice: 4200 });
    expect(positions[1]).toMatchObject({
      positionCode: "1.01.2",
      unitPrice: 400,
    });
    expect(positions[2]).toMatchObject({ quantity: 6, unit: "Stk.", unitPrice: 48 });
  });

  it("normalizes units used in the uploaded reference PDFs", () => {
    expect(normalizeUnit("paus")).toBe("psch.");
    expect(normalizeUnit("StkW")).toBe("StkW");
    expect(normalizeUnit("lfm/Wo")).toBe("lfm/Wo");
    expect(normalizeUnit("Stgm")).toBe("Stgm");
  });
});
