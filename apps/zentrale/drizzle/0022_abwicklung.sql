CREATE TABLE `abwicklungen` (
	`betreiber_id` text NOT NULL,
	`installation_id` text NOT NULL,
	`kunde_id` text NOT NULL,
	`vertragsende` integer NOT NULL,
	`schritt` text NOT NULL,
	`archiv_auftrag_id` text,
	`archiv` text,
	`loesch_auftrag_id` text,
	`versuche` integer DEFAULT 0 NOT NULL,
	`naechster_versuch` integer,
	`protokoll` text NOT NULL,
	`angelegt_am` integer NOT NULL,
	`geaendert_am` integer NOT NULL,
	`link_bis` integer,
	`geloescht_am` integer,
	PRIMARY KEY(`betreiber_id`, `installation_id`),
	FOREIGN KEY (`betreiber_id`,`installation_id`) REFERENCES `installationen`(`betreiber_id`,`installation_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `abwicklungen_kunde` ON `abwicklungen` (`betreiber_id`,`kunde_id`);