CREATE TABLE `installation_konfigurationen` (
	`betreiber_id` text NOT NULL,
	`auftrag_id` text NOT NULL,
	`installation_id` text NOT NULL,
	`einstellungen` text NOT NULL,
	`geheim` text NOT NULL,
	`angelegt_am` integer NOT NULL,
	PRIMARY KEY(`betreiber_id`, `auftrag_id`),
	FOREIGN KEY (`betreiber_id`,`installation_id`) REFERENCES `installationen`(`betreiber_id`,`installation_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `installation_konfigurationen_installation` ON `installation_konfigurationen` (`betreiber_id`,`installation_id`);