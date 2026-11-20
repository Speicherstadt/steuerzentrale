CREATE TABLE `einladungen` (
	`betreiber_id` text NOT NULL,
	`einladung_id` text NOT NULL,
	`rolle` text NOT NULL,
	`gueltig_bis` integer NOT NULL,
	`angelegt_von` text NOT NULL,
	`angelegt_am` integer NOT NULL,
	`angenommen_von` text,
	`angenommen_am` integer,
	PRIMARY KEY(`betreiber_id`, `einladung_id`)
);
--> statement-breakpoint
CREATE TABLE `mitglieder` (
	`betreiber_id` text NOT NULL,
	`nutzer_id` text NOT NULL,
	`rolle` text NOT NULL,
	`angelegt_am` integer NOT NULL,
	PRIMARY KEY(`betreiber_id`, `nutzer_id`)
);
--> statement-breakpoint
CREATE INDEX `mitglieder_nutzer` ON `mitglieder` (`nutzer_id`);