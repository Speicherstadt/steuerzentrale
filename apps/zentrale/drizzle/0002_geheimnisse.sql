CREATE TABLE `geheimnisse` (
	`betreiber_id` text NOT NULL,
	`geheimnis_id` text NOT NULL,
	`zweck` text NOT NULL,
	`wert` text NOT NULL,
	`geaendert_am` integer NOT NULL,
	PRIMARY KEY(`betreiber_id`, `geheimnis_id`)
);
--> statement-breakpoint
CREATE TABLE `tokens` (
	`betreiber_id` text NOT NULL,
	`token_id` text NOT NULL,
	`zweck` text NOT NULL,
	`hash` text NOT NULL,
	`gueltig_bis` integer,
	`angelegt_am` integer NOT NULL,
	PRIMARY KEY(`betreiber_id`, `token_id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tokens_hash_unique` ON `tokens` (`hash`);