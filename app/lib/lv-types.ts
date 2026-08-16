import type { Workbook } from "exceljs";

export type LvFileKind = "xlsx" | "pdf" | "image";
export type WorkCategory = "geruest" | "innen" | "aussen" | "sonstiges";

export type ParsedPosition = {
  id: string;
  positionCode: string;
  shortDescription: string;
  longDescription: string;
  description: string;
  normalizedDescription: string;
  propertyManagement: string;
  workCategory: WorkCategory;
  quantity: number | null;
  unit: string;
  unitPrice: number | null;
  totalPrice: number | null;
  sheetName: string;
  rowNumber: number;
  priceColumn: number | null;
  totalColumn: number | null;
};

export type ParsedDocument = {
  fileName: string;
  kind: LvFileKind;
  positions: ParsedPosition[];
  propertyManagement: string;
  workbook: Workbook | null;
  warnings: string[];
};

export type CatalogEntry = {
  id: string;
  description: string;
  shortDescription: string;
  longDescription: string;
  normalizedDescription: string;
  propertyManagement: string;
  workCategory: WorkCategory;
  unit: string;
  unitPrice: number;
  sourceFileName: string;
  createdAt: string;
};

export type MatchStatus = "matched" | "open" | "existing";

export type PositionMatch = {
  position: ParsedPosition;
  status: MatchStatus;
  unitPrice: number | null;
  confidence: number;
  sourceFileName: string | null;
  referenceCount: number;
  reason: string;
};

export type CatalogStats = {
  referenceFiles: number;
  priceEntries: number;
  lastImportAt: string | null;
};

export type RecentReference = {
  id: string;
  fileName: string;
  fileType: string;
  fingerprint: string;
  propertyManagement: string;
  positionCount: number;
  reviewedAt: string | null;
  importedBy: string | null;
  createdAt: string;
};

export type ProcessingJob = {
  id: string;
  fileName: string;
  fileType: string;
  totalPositions: number;
  matchedCount: number;
  openCount: number;
  processedBy: string | null;
  createdAt: string;
};

export type StoredDocument = {
  id: string;
  fileName: string;
  fileType: string;
  contentType: string;
  fileSize: number;
  fingerprint: string;
  purpose: "reference" | "new_lv";
  status: "gespeichert" | "eingelesen" | "verarbeitet" | "pruefen" | "fehler";
  propertyManagement: string;
  positionCount: number;
  reviewedAt: string | null;
  importedBy: string | null;
  createdAt: string;
  updatedAt: string;
};
