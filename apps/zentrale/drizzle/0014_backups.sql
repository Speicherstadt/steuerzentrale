CREATE TABLE `backup_ziele` (
	`betreiber_id` text PRIMARY KEY NOT NULL,
	`endpunkt` text NOT NULL,
	`region` text NOT NULL,
	`bucket` text NOT NULL,
	`geaendert_am` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `backup_zugaenge` (
	`betreiber_id` text NOT NULL,
	`installation_id` text NOT NULL,
	`zustand` text NOT NULL,
	`versuche` integer DEFAULT 0 NOT NULL,
	`naechster_versuch` integer,
	`geheim` text NOT NULL,
	`angelegt_am` integer NOT NULL,
	`geaendert_am` integer NOT NULL,
	PRIMARY KEY(`betreiber_id`, `installation_id`),
	FOREIGN KEY (`betreiber_id`,`installation_id`) REFERENCES `installationen`(`betreiber_id`,`installation_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `backup_zugaenge_faellig` ON `backup_zugaenge` (`naechster_versuch`);--> statement-breakpoint
CREATE TABLE `backups` (
	`betreiber_id` text NOT NULL,
	`backup_id` text NOT NULL,
	`installation_id` text NOT NULL,
	`server_id` text NOT NULL,
	`zeitpunkt` integer NOT NULL,
	`ok` integer NOT NULL,
	`teile` text NOT NULL,
	`grund` text,
	`gemeldet_am` integer NOT NULL,
	PRIMARY KEY(`betreiber_id`, `backup_id`),
	FOREIGN KEY (`betreiber_id`,`installation_id`) REFERENCES `installationen`(`betreiber_id`,`installation_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `backups_installation` ON `backups` (`betreiber_id`,`installation_id`,`zeitpunkt`);--> statement-breakpoint
CREATE INDEX `backups_zeitpunkt` ON `backups` (`zeitpunkt`);