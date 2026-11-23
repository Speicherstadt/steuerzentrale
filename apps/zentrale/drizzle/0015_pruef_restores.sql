CREATE TABLE `pruef_restores` (
	`betreiber_id` text NOT NULL,
	`auftrag_id` text NOT NULL,
	`installation_id` text NOT NULL,
	`server_id` text NOT NULL,
	`kopie` text NOT NULL,
	`zeitpunkt` integer NOT NULL,
	`ok` integer NOT NULL,
	`grund` text,
	`teile` text NOT NULL,
	`dauer_ms` integer,
	PRIMARY KEY(`betreiber_id`, `auftrag_id`),
	FOREIGN KEY (`betreiber_id`,`installation_id`) REFERENCES `installationen`(`betreiber_id`,`installation_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `pruef_restores_installation` ON `pruef_restores` (`betreiber_id`,`installation_id`,`zeitpunkt`);--> statement-breakpoint
CREATE INDEX `pruef_restores_zeitpunkt` ON `pruef_restores` (`zeitpunkt`);