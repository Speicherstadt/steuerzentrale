CREATE TABLE `support_zugaenge` (
	`betreiber_id` text NOT NULL,
	`zugang_id` text NOT NULL,
	`installation_id` text NOT NULL,
	`nutzer_id` text NOT NULL,
	`grund` text NOT NULL,
	`beginn` integer NOT NULL,
	`ende` integer NOT NULL,
	`beendet_am` integer,
	`beendet_von` text,
	`ende_gemeldet_am` integer,
	PRIMARY KEY(`betreiber_id`, `zugang_id`),
	FOREIGN KEY (`betreiber_id`,`installation_id`) REFERENCES `installationen`(`betreiber_id`,`installation_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `support_zugaenge_nutzer` ON `support_zugaenge` (`betreiber_id`,`nutzer_id`,`installation_id`,`ende`);--> statement-breakpoint
CREATE INDEX `support_zugaenge_beginn` ON `support_zugaenge` (`betreiber_id`,`beginn`);