CREATE TABLE `auftraege` (
	`betreiber_id` text NOT NULL,
	`auftrag_id` text NOT NULL,
	`server_id` text NOT NULL,
	`installation_id` text,
	`aktion` text NOT NULL,
	`app` text NOT NULL,
	`version` text NOT NULL,
	`manifest_hash` text NOT NULL,
	`manifest` text NOT NULL,
	`signatur` text NOT NULL,
	`argumente` text NOT NULL,
	`zeitlimit_s` integer NOT NULL,
	`zustand` text NOT NULL,
	`wartet_auf` text NOT NULL,
	`fortschritt` text,
	`fortschritt_am` integer,
	`ergebnis` text,
	`angelegt_von` text NOT NULL,
	`angelegt_am` integer NOT NULL,
	`geaendert_am` integer NOT NULL,
	PRIMARY KEY(`betreiber_id`, `auftrag_id`),
	FOREIGN KEY (`betreiber_id`,`server_id`) REFERENCES `server`(`betreiber_id`,`server_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `auftraege_server` ON `auftraege` (`betreiber_id`,`server_id`,`zustand`);--> statement-breakpoint
CREATE INDEX `auftraege_zustand` ON `auftraege` (`betreiber_id`,`zustand`);