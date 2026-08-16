ALTER TABLE `price_entries` ADD `short_description` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `price_entries` ADD `long_description` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `price_entries` ADD `work_category` text DEFAULT 'sonstiges' NOT NULL;--> statement-breakpoint
ALTER TABLE `reference_files` ADD `property_management` text DEFAULT '' NOT NULL;