export const MAX_FILE_SIZE = 25 * 1024 * 1024;

export type SupportedFile = {
  extension: "xlsx" | "pdf" | "jpg" | "jpeg" | "png" | "webp";
  fileType: "xlsx" | "pdf" | "image";
  allowedContentTypes: readonly string[];
};

const FILES: Record<SupportedFile["extension"], SupportedFile> = {
  xlsx: {
    extension: "xlsx",
    fileType: "xlsx",
    allowedContentTypes: [
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/octet-stream",
    ],
  },
  pdf: {
    extension: "pdf",
    fileType: "pdf",
    allowedContentTypes: ["application/pdf", "application/octet-stream"],
  },
  jpg: {
    extension: "jpg",
    fileType: "image",
    allowedContentTypes: ["image/jpeg", "application/octet-stream"],
  },
  jpeg: {
    extension: "jpeg",
    fileType: "image",
    allowedContentTypes: ["image/jpeg", "application/octet-stream"],
  },
  png: {
    extension: "png",
    fileType: "image",
    allowedContentTypes: ["image/png", "application/octet-stream"],
  },
  webp: {
    extension: "webp",
    fileType: "image",
    allowedContentTypes: ["image/webp", "application/octet-stream"],
  },
};

export const ALL_ALLOWED_CONTENT_TYPES = [
  ...new Set(Object.values(FILES).flatMap((entry) => entry.allowedContentTypes)),
];

export function cleanFileName(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/[\\/\u0000-\u001f\u007f]/g, "_")
    .trim()
    .slice(0, 240);
}

export function supportedFile(fileName: string): SupportedFile | null {
  const extension = fileName.split(".").pop()?.toLowerCase();
  return extension && extension in FILES
    ? FILES[extension as SupportedFile["extension"]]
    : null;
}

export function validateFileMetadata(
  fileName: string,
  size: number,
  contentType: string,
): string | null {
  const supported = supportedFile(fileName);
  if (!supported) {
    return "Erlaubt sind Excel (.xlsx), PDF und Bilder (JPG, PNG, WEBP).";
  }
  if (!Number.isFinite(size) || size <= 0 || size > MAX_FILE_SIZE) {
    return "Die Datei ist leer oder größer als 25 MB.";
  }
  if (!supported.allowedContentTypes.includes(contentType || "application/octet-stream")) {
    return "Dateiendung und Inhaltstyp passen nicht zusammen.";
  }
  return null;
}

export function hasExpectedMagic(fileName: string, bytes: Uint8Array): boolean {
  const supported = supportedFile(fileName);
  if (!supported) return false;

  switch (supported.extension) {
    case "pdf":
      return startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d]);
    case "xlsx":
      return startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]);
    case "jpg":
    case "jpeg":
      return startsWith(bytes, [0xff, 0xd8, 0xff]);
    case "png":
      return startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case "webp":
      return (
        startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
        bytes[8] === 0x57 &&
        bytes[9] === 0x45 &&
        bytes[10] === 0x42 &&
        bytes[11] === 0x50
      );
  }
}

function startsWith(bytes: Uint8Array, signature: number[]): boolean {
  return signature.every((value, index) => bytes[index] === value);
}
