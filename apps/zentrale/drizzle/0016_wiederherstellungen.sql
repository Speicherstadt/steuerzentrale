CREATE TABLE `wiederherstellungen` (
	`betreiber_id` text NOT NULL,
	`auftrag_id` text NOT NULL,
	`backup_auftrag_id` text NOT NULL,
	`installation_id` text NOT NULL,
	`server_id` text NOT NULL,
	`backup_id` text NOT NULL,
	`lauf_zeitpunkt` integer NOT NULL,
	`angefordert_am` integer NOT NULL,
	`ende_am` integer,
	`ok` integer,
	`fehler` text,
	`teile` text NOT NULL,
	`dauer_ms` integer,
	PRIMARY KEY(`betreiber_id`, `auftrag_id`),
	FOREIGN KEY (`betreiber_id`,`installation_id`) REFERENCES `installationen`(`betreiber_id`,`installation_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `wiederherstellungen_installation` ON `wiederherstellungen` (`betreiber_id`,`installation_id`,`angefordert_am`);--> statement-breakpoint
CREATE INDEX `wiederherstellungen_backup_auftrag` ON `wiederherstellungen` (`betreiber_id`,`backup_auftrag_id`);