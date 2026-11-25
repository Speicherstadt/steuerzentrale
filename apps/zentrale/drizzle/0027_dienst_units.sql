CREATE TABLE `dienst_innen` (
	`betreiber_id` text NOT NULL,
	`dienst_id` text NOT NULL,
	`bewertung` text NOT NULL,
	`grund` text NOT NULL,
	`seit` integer NOT NULL,
	`gemeldet_am` integer NOT NULL,
	`meldung` text NOT NULL,
	PRIMARY KEY(`betreiber_id`, `dienst_id`),
	FOREIGN KEY (`betreiber_id`,`dienst_id`) REFERENCES `dienste`(`betreiber_id`,`dienst_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_dienste` (
	`betreiber_id` text NOT NULL,
	`dienst_id` text NOT NULL,
	`name` text NOT NULL,
	`host` text NOT NULL,
	`pfad` text NOT NULL,
	`kunde_id` text,
	`angelegt_am` integer NOT NULL,
	`entfernt_am` integer,
	`server_id` text,
	`nutzer` text,
	`units` text,
	`health_port` integer,
	`health_pfad` text,
	PRIMARY KEY(`betreiber_id`, `dienst_id`),
	FOREIGN KEY (`betreiber_id`,`kunde_id`) REFERENCES `kunden`(`betreiber_id`,`kunde_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`betreiber_id`,`server_id`) REFERENCES `server`(`betreiber_id`,`server_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_dienste`("betreiber_id", "dienst_id", "name", "host", "pfad", "kunde_id", "angelegt_am", "entfernt_am", "server_id", "nutzer", "units", "health_port", "health_pfad") SELECT "betreiber_id", "dienst_id", "name", "host", "pfad", "kunde_id", "angelegt_am", "entfernt_am", "server_id", "nutzer", "units", "health_port", "health_pfad" FROM `dienste`;--> statement-breakpoint
DROP TABLE `dienste`;--> statement-breakpoint
ALTER TABLE `__new_dienste` RENAME TO `dienste`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `dienste_server` ON `dienste` (`betreiber_id`,`server_id`);