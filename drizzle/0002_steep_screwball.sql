CREATE TABLE `stored_documents` (
	`id` text PRIMARY KEY NOT NULL,
	`file_name` text NOT NULL,
	`file_type` text NOT NULL,
	`content_type` text DEFAULT 'application/octet-stream' NOT NULL,
	`file_size` integer DEFAULT 0 NOT NULL,
	`fingerprint` text NOT NULL,
	`storage_key` text NOT NULL,
	`purpose` text DEFAULT 'reference' NOT NULL,
	`status` text DEFAULT 'gespeichert' NOT NULL,
	`property_management` text DEFAULT '' NOT NULL,
	`position_count` integer DEFAULT 0 NOT NULL,
	`imported_by` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `stored_documents_fingerprint_uq` ON `stored_documents` (`fingerprint`);--> statement-breakpoint
CREATE INDEX `stored_documents_created_idx` ON `stored_documents` (`created_at`);