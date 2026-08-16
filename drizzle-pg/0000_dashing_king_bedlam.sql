CREATE TABLE "price_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"reference_file_id" text NOT NULL,
	"position_code" text,
	"short_description" text DEFAULT '' NOT NULL,
	"long_description" text DEFAULT '' NOT NULL,
	"description" text NOT NULL,
	"normalized_description" text NOT NULL,
	"work_category" text DEFAULT 'sonstiges' NOT NULL,
	"unit" text DEFAULT '' NOT NULL,
	"unit_price" real NOT NULL,
	"source_sheet" text,
	"source_row" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "processing_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"file_name" text NOT NULL,
	"file_type" text NOT NULL,
	"fingerprint" text NOT NULL,
	"total_positions" integer DEFAULT 0 NOT NULL,
	"matched_count" integer DEFAULT 0 NOT NULL,
	"open_count" integer DEFAULT 0 NOT NULL,
	"processed_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reference_files" (
	"id" text PRIMARY KEY NOT NULL,
	"file_name" text NOT NULL,
	"file_type" text NOT NULL,
	"property_management" text DEFAULT '' NOT NULL,
	"fingerprint" text NOT NULL,
	"position_count" integer DEFAULT 0 NOT NULL,
	"imported_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stored_documents" (
	"id" text PRIMARY KEY NOT NULL,
	"file_name" text NOT NULL,
	"file_type" text NOT NULL,
	"content_type" text DEFAULT 'application/octet-stream' NOT NULL,
	"file_size" integer DEFAULT 0 NOT NULL,
	"fingerprint" text NOT NULL,
	"storage_key" text NOT NULL,
	"purpose" text DEFAULT 'reference' NOT NULL,
	"status" text DEFAULT 'gespeichert' NOT NULL,
	"property_management" text DEFAULT '' NOT NULL,
	"position_count" integer DEFAULT 0 NOT NULL,
	"reviewed_at" timestamp with time zone,
	"imported_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "price_entries" ADD CONSTRAINT "price_entries_reference_file_id_reference_files_id_fk" FOREIGN KEY ("reference_file_id") REFERENCES "public"."reference_files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "price_entries_reference_idx" ON "price_entries" USING btree ("reference_file_id");--> statement-breakpoint
CREATE INDEX "price_entries_match_idx" ON "price_entries" USING btree ("normalized_description","unit");--> statement-breakpoint
CREATE UNIQUE INDEX "processing_jobs_fingerprint_uq" ON "processing_jobs" USING btree ("fingerprint");--> statement-breakpoint
CREATE INDEX "processing_jobs_created_idx" ON "processing_jobs" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "reference_files_fingerprint_uq" ON "reference_files" USING btree ("fingerprint");--> statement-breakpoint
CREATE UNIQUE INDEX "stored_documents_fingerprint_uq" ON "stored_documents" USING btree ("fingerprint");--> statement-breakpoint
CREATE INDEX "stored_documents_created_idx" ON "stored_documents" USING btree ("created_at");