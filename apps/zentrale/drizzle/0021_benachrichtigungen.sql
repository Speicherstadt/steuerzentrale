CREATE TABLE `benachrichtigung_einstellungen` (
	`betreiber_id` text PRIMARY KEY NOT NULL,
	`smtp_host` text,
	`smtp_port` integer,
	`smtp_sicherheit` text,
	`smtp_benutzer` text,
	`absender` text,
	`ruhe_von` text,
	`ruhe_bis` text,
	`geaendert_am` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `empfaenger` (
	`betreiber_id` text NOT NULL,
	`empfaenger_id` text NOT NULL,
	`art` text NOT NULL,
	`anzeige` text NOT NULL,
	`ab_schwere` text NOT NULL,
	`geheim` text,
	`angelegt_am` integer NOT NULL,
	PRIMARY KEY(`betreiber_id`, `empfaenger_id`)
);
--> statement-breakpoint
CREATE TABLE `zustellungen` (
	`betreiber_id` text NOT NULL,
	`zustellung_id` text NOT NULL,
	`ereignis_id` text NOT NULL,
	`empfaenger_id` text NOT NULL,
	`schwere` text NOT NULL,
	`zustand` text NOT NULL,
	`versuche` integer NOT NULL,
	`faellig_am` integer NOT NULL,
	`fehler` text,
	`angelegt_am` integer NOT NULL,
	`erledigt_am` integer,
	PRIMARY KEY(`betreiber_id`, `zustellung_id`)
);
--> statement-breakpoint
CREATE INDEX `zustellungen_faellig` ON `zustellungen` (`zustand`,`faellig_am`);--> statement-breakpoint
CREATE INDEX `zustellungen_angelegt` ON `zustellungen` (`betreiber_id`,`angelegt_am`);--> statement-breakpoint
CREATE INDEX `zustellungen_ereignis` ON `zustellungen` (`betreiber_id`,`ereignis_id`);