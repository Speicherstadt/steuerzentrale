CREATE TABLE `kunden` (
	`betreiber_id` text NOT NULL,
	`kunde_id` text NOT NULL,
	`name` text NOT NULL,
	`kontakt_name` text NOT NULL,
	`kontakt_email` text NOT NULL,
	`kontakt_telefon` text,
	`notiz` text,
	`angelegt_am` integer NOT NULL,
	PRIMARY KEY(`betreiber_id`, `kunde_id`)
);
--> statement-breakpoint
CREATE TABLE `vertraege` (
	`betreiber_id` text NOT NULL,
	`vertrag_id` text NOT NULL,
	`kunde_id` text NOT NULL,
	`sla` text NOT NULL,
	`beginn` integer NOT NULL,
	`ende` integer,
	`angelegt_am` integer NOT NULL,
	PRIMARY KEY(`betreiber_id`, `vertrag_id`),
	FOREIGN KEY (`betreiber_id`,`kunde_id`) REFERENCES `kunden`(`betreiber_id`,`kunde_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `vertraege_kunde` ON `vertraege` (`betreiber_id`,`kunde_id`);