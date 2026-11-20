CREATE TABLE `audit_log` (
	`nummer` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`betreiber_id` text NOT NULL,
	`zeitpunkt` integer NOT NULL,
	`akteur` text NOT NULL,
	`aktion` text NOT NULL,
	`ziel` text NOT NULL,
	`grund` text NOT NULL,
	`inhalt` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `audit_log_betreiber` ON `audit_log` (`betreiber_id`,`zeitpunkt`);--> statement-breakpoint
CREATE TABLE `betreiber` (
	`betreiber_id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`angelegt_am` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `ereignisse` (
	`betreiber_id` text NOT NULL,
	`ereignis_id` text NOT NULL,
	`zeitpunkt` integer NOT NULL,
	`art` text NOT NULL,
	`schwere` text NOT NULL,
	`ziel` text NOT NULL,
	`text` text NOT NULL,
	PRIMARY KEY(`betreiber_id`, `ereignis_id`)
);
--> statement-breakpoint
CREATE INDEX `ereignisse_zeitpunkt` ON `ereignisse` (`zeitpunkt`);--> statement-breakpoint
CREATE TABLE `heartbeats` (
	`betreiber_id` text NOT NULL,
	`server_id` text NOT NULL,
	`zeitpunkt` integer NOT NULL,
	`daten` text NOT NULL,
	PRIMARY KEY(`betreiber_id`, `server_id`, `zeitpunkt`)
);
--> statement-breakpoint
CREATE INDEX `heartbeats_zeitpunkt` ON `heartbeats` (`zeitpunkt`);--> statement-breakpoint
CREATE TABLE `log_auszuege` (
	`betreiber_id` text NOT NULL,
	`auszug_id` text NOT NULL,
	`auftrag_id` text NOT NULL,
	`zeitpunkt` integer NOT NULL,
	`inhalt` text NOT NULL,
	PRIMARY KEY(`betreiber_id`, `auszug_id`)
);
--> statement-breakpoint
CREATE INDEX `log_auszuege_zeitpunkt` ON `log_auszuege` (`zeitpunkt`);