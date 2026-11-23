CREATE TABLE `aussen_pruefungen` (
	`betreiber_id` text NOT NULL,
	`installation_id` text NOT NULL,
	`zustand` text NOT NULL,
	`grund` text NOT NULL,
	`seit` integer NOT NULL,
	`geprueft_am` integer NOT NULL,
	`ergebnis` text NOT NULL,
	PRIMARY KEY(`betreiber_id`, `installation_id`),
	FOREIGN KEY (`betreiber_id`,`installation_id`) REFERENCES `installationen`(`betreiber_id`,`installation_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `verfuegbarkeit` (
	`betreiber_id` text NOT NULL,
	`installation_id` text NOT NULL,
	`stunde` integer NOT NULL,
	`gemessen` integer NOT NULL,
	`rot` integer NOT NULL,
	PRIMARY KEY(`betreiber_id`, `installation_id`, `stunde`),
	FOREIGN KEY (`betreiber_id`,`installation_id`) REFERENCES `installationen`(`betreiber_id`,`installation_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `verfuegbarkeit_stunde` ON `verfuegbarkeit` (`stunde`);