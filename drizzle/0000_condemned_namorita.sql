CREATE TABLE `price_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`reference_file_id` text NOT NULL,
	`position_code` text,
	`description` text NOT NULL,
	`normalized_description` text NOT NULL,
	`unit` text DEFAULT '' NOT NULL,
	`unit_price` real NOT NULL,
	`source_sheet` text,
	`source_row` integer,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`reference_file_id`) REFERENCES `reference_files`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `price_entries_reference_idx` ON `price_entries` (`reference_file_id`);--> statement-breakpoint
CREATE INDEX `price_entries_match_idx` ON `price_entries` (`normalized_description`,`unit`);--> statement-breakpoint
CREATE TABLE `processing_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`file_name` text NOT NULL,
	`file_type` text NOT NULL,
	`fingerprint` text NOT NULL,
	`total_positions` integer DEFAULT 0 NOT NULL,
	`matched_count` integer DEFAULT 0 NOT NULL,
	`open_count` integer DEFAULT 0 NOT NULL,
	`processed_by` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `processing_jobs_created_idx` ON `processing_jobs` (`created_at`);--> statement-breakpoint
CREATE TABLE `reference_files` (
	`id` text PRIMARY KEY NOT NULL,
	`file_name` text NOT NULL,
	`file_type` text NOT NULL,
	`fingerprint` text NOT NULL,
	`position_count` integer DEFAULT 0 NOT NULL,
	`imported_by` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `reference_files_fingerprint_uq` ON `reference_files` (`fingerprint`);