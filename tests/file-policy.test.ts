import { describe, expect, it } from "vitest";
import {
  cleanFileName,
  hasExpectedMagic,
  MAX_FILE_SIZE,
  supportedFile,
  validateFileMetadata,
} from "../app/lib/file-policy";

describe("file policy", () => {
  it("accepts supported metadata within the size limit", () => {
    expect(
      validateFileMetadata("preise.xlsx", MAX_FILE_SIZE, "application/octet-stream"),
    ).toBeNull();
    expect(supportedFile("angebot.PDF")?.fileType).toBe("pdf");
  });

  it("rejects unsupported, oversized, and MIME-spoofed files", () => {
    expect(validateFileMetadata("malware.exe", 100, "application/octet-stream")).toMatch(
      /Erlaubt/,
    );
    expect(validateFileMetadata("bild.png", MAX_FILE_SIZE + 1, "image/png")).toMatch(
      /25 MB/,
    );
    expect(validateFileMetadata("bild.png", 100, "application/pdf")).toMatch(
      /passen nicht/,
    );
  });

  it("checks file signatures instead of trusting the extension", () => {
    expect(hasExpectedMagic("dokument.pdf", new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d])))
      .toBe(true);
    expect(hasExpectedMagic("dokument.pdf", new Uint8Array([0x4d, 0x5a, 0x90])))
      .toBe(false);
    expect(
      hasExpectedMagic(
        "bild.webp",
        new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]),
      ),
    ).toBe(true);
  });

  it("removes path separators and control characters from display names", () => {
    expect(cleanFileName(" ../ordner\\preise\u0000.xlsx ")).toBe(".._ordner_preise_.xlsx");
  });
});
