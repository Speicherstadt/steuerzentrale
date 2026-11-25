CREATE TABLE `dienst_pruefungen` (
	`betreiber_id` text NOT NULL,
	`dienst_id` text NOT NULL,
	`zustand` text NOT NULL,
	`grund` text NOT NULL,
	`seit` integer NOT NULL,
	`geprueft_am` integer NOT NULL,
	`ergebnis` text NOT NULL,
	PRIMARY KEY(`betreiber_id`, `dienst_id`),
	FOREIGN KEY (`betreiber_id`,`dienst_id`) REFERENCES `dienste`(`betreiber_id`,`dienst_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `dienst_verfuegbarkeit` (
	`betreiber_id` text NOT NULL,
	`dienst_id` text NOT NULL,
	`stunde` integer NOT NULL,
	`gemessen` integer NOT NULL,
	`rot` integer NOT NULL,
	PRIMARY KEY(`betreiber_id`, `dienst_id`, `stunde`),
	FOREIGN KEY (`betreiber_id`,`dienst_id`) REFERENCES `dienste`(`betreiber_id`,`dienst_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `dienst_verfuegbarkeit_stunde` ON `dienst_verfuegbarkeit` (`stunde`);--> statement-breakpoint
CREATE TABLE `dienste` (
	`betreiber_id` text NOT NULL,
	`dienst_id` text NOT NULL,
	`name` text NOT NULL,
	`host` text NOT NULL,
	`pfad` text NOT NULL,
	`kunde_id` text,
	`angelegt_am` integer NOT NULL,
	`entfernt_am` integer,
	PRIMARY KEY(`betreiber_id`, `dienst_id`),
	FOREIGN KEY (`betreiber_id`,`kunde_id`) REFERENCES `kunden`(`betreiber_id`,`kunde_id`) ON UPDATE no action ON DELETE no action
);
