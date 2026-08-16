import {
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

const createdAt = () =>
  timestamp("created_at", { mode: "string", withTimezone: true })
    .notNull()
    .defaultNow();

export const referenceFiles = pgTable(
  "reference_files",
  {
    id: text("id").primaryKey(),
    fileName: text("file_name").notNull(),
    fileType: text("file_type").notNull(),
    propertyManagement: text("property_management").notNull().default(""),
    fingerprint: text("fingerprint").notNull(),
    positionCount: integer("position_count").notNull().default(0),
    importedBy: text("imported_by"),
    createdAt: createdAt(),
  },
  (table) => [uniqueIndex("reference_files_fingerprint_uq").on(table.fingerprint)],
);

export const priceEntries = pgTable(
  "price_entries",
  {
    id: text("id").primaryKey(),
    referenceFileId: text("reference_file_id")
      .notNull()
      .references(() => referenceFiles.id, { onDelete: "cascade" }),
    positionCode: text("position_code"),
    shortDescription: text("short_description").notNull().default(""),
    longDescription: text("long_description").notNull().default(""),
    description: text("description").notNull(),
    normalizedDescription: text("normalized_description").notNull(),
    workCategory: text("work_category").notNull().default("sonstiges"),
    unit: text("unit").notNull().default(""),
    unitPrice: numeric("unit_price", {
      mode: "number",
      precision: 12,
      scale: 2,
    }).notNull(),
    sourceSheet: text("source_sheet"),
    sourceRow: integer("source_row"),
    createdAt: createdAt(),
  },
  (table) => [
    index("price_entries_reference_idx").on(table.referenceFileId),
    index("price_entries_match_idx").on(
      table.normalizedDescription,
      table.unit,
    ),
  ],
);

export const processingJobs = pgTable(
  "processing_jobs",
  {
    id: text("id").primaryKey(),
    fileName: text("file_name").notNull(),
    fileType: text("file_type").notNull(),
    fingerprint: text("fingerprint").notNull(),
    totalPositions: integer("total_positions").notNull().default(0),
    matchedCount: integer("matched_count").notNull().default(0),
    openCount: integer("open_count").notNull().default(0),
    processedBy: text("processed_by"),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("processing_jobs_fingerprint_uq").on(table.fingerprint),
    index("processing_jobs_created_idx").on(table.createdAt),
  ],
);

export const storedDocuments = pgTable(
  "stored_documents",
  {
    id: text("id").primaryKey(),
    fileName: text("file_name").notNull(),
    fileType: text("file_type").notNull(),
    contentType: text("content_type").notNull().default("application/octet-stream"),
    fileSize: integer("file_size").notNull().default(0),
    fingerprint: text("fingerprint").notNull(),
    storageKey: text("storage_key").notNull(),
    purpose: text("purpose").notNull().default("reference"),
    status: text("status").notNull().default("gespeichert"),
    propertyManagement: text("property_management").notNull().default(""),
    positionCount: integer("position_count").notNull().default(0),
    reviewedAt: timestamp("reviewed_at", { mode: "string", withTimezone: true }),
    importedBy: text("imported_by"),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { mode: "string", withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("stored_documents_fingerprint_uq").on(table.fingerprint),
    index("stored_documents_created_idx").on(table.createdAt),
  ],
);
