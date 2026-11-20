CREATE TABLE `fakten` (
	`betreiber_id` text NOT NULL,
	`server_id` text NOT NULL,
	`zeitpunkt` integer NOT NULL,
	`daten` text NOT NULL,
	PRIMARY KEY(`betreiber_id`, `server_id`, `zeitpunkt`)
);
--> statement-breakpoint
CREATE INDEX `fakten_zeitpunkt` ON `fakten` (`zeitpunkt`);--> statement-breakpoint
ALTER TABLE `server` ADD `fakten` text;--> statement-breakpoint
ALTER TABLE `server` ADD `fakten_am` integer;