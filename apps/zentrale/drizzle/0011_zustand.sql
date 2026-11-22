CREATE TABLE `installation_verlauf` (
	`betreiber_id` text NOT NULL,
	`installation_id` text NOT NULL,
	`zeitpunkt` integer NOT NULL,
	`bewertung` text NOT NULL,
	`grund` text NOT NULL,
	PRIMARY KEY(`betreiber_id`, `installation_id`, `zeitpunkt`),
	FOREIGN KEY (`betreiber_id`,`installation_id`) REFERENCES `installationen`(`betreiber_id`,`installation_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `installation_verlauf_zeitpunkt` ON `installation_verlauf` (`zeitpunkt`);--> statement-breakpoint
ALTER TABLE `installationen` ADD `bewertung` text;--> statement-breakpoint
ALTER TABLE `installationen` ADD `bewertung_grund` text;--> statement-breakpoint
ALTER TABLE `installationen` ADD `bewertung_seit` integer;--> statement-breakpoint
ALTER TABLE `installationen` ADD `gemeldet_am` integer;--> statement-breakpoint
ALTER TABLE `installationen` ADD `meldung` text;