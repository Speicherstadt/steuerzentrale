CREATE TABLE `updates` (
	`betreiber_id` text NOT NULL,
	`auftrag_id` text NOT NULL,
	`backup_auftrag_id` text NOT NULL,
	`installation_id` text NOT NULL,
	`server_id` text NOT NULL,
	`app` text NOT NULL,
	`von_version` text NOT NULL,
	`nach_version` text NOT NULL,
	`anlass` text NOT NULL,
	`welle` text,
	`sperrzeit_uebergangen` integer NOT NULL,
	`angefordert_am` integer NOT NULL,
	`ende_am` integer,
	`ergebnis` text,
	`fehler` text,
	`dauer_ms` integer,
	PRIMARY KEY(`betreiber_id`, `auftrag_id`),
	FOREIGN KEY (`betreiber_id`,`installation_id`) REFERENCES `installationen`(`betreiber_id`,`installation_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `updates_installation` ON `updates` (`betreiber_id`,`installation_id`,`angefordert_am`);--> statement-breakpoint
CREATE INDEX `updates_backup_auftrag` ON `updates` (`betreiber_id`,`backup_auftrag_id`);--> statement-breakpoint
CREATE INDEX `updates_version` ON `updates` (`betreiber_id`,`app`,`nach_version`);