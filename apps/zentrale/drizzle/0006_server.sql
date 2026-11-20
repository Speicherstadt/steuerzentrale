CREATE TABLE `server` (
	`betreiber_id` text NOT NULL,
	`server_id` text NOT NULL,
	`name` text NOT NULL,
	`art` text NOT NULL,
	`kunde_id` text,
	`wartungsfenster` text NOT NULL,
	`fingerabdruck` text,
	`zertifikat_gueltig_bis` integer,
	`beigetreten_am` integer,
	`architektur` text,
	`agent_version` text,
	`angelegt_von` text NOT NULL,
	`angelegt_am` integer NOT NULL,
	PRIMARY KEY(`betreiber_id`, `server_id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `server_fingerabdruck_unique` ON `server` (`fingerabdruck`);