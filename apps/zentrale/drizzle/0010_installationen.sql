CREATE TABLE `app_einstellungen` (
	`betreiber_id` text NOT NULL,
	`app` text NOT NULL,
	`name` text NOT NULL,
	`wert` text,
	`wert_verschluesselt` text,
	`geaendert_am` integer NOT NULL,
	PRIMARY KEY(`betreiber_id`, `app`, `name`)
);
--> statement-breakpoint
CREATE TABLE `installationen` (
	`betreiber_id` text NOT NULL,
	`installation_id` text NOT NULL,
	`kunde_id` text NOT NULL,
	`server_id` text NOT NULL,
	`app` text NOT NULL,
	`version` text NOT NULL,
	`manifest_hash` text NOT NULL,
	`manifest` text NOT NULL,
	`signatur` text NOT NULL,
	`host` text NOT NULL,
	`ipv4` text,
	`http_port` integer,
	`ports` text NOT NULL,
	`optionen` text NOT NULL,
	`einstellungen` text NOT NULL,
	`geheim` text NOT NULL,
	`zustand` text NOT NULL,
	`angelegt_von` text NOT NULL,
	`angelegt_am` integer NOT NULL,
	`geaendert_am` integer NOT NULL,
	PRIMARY KEY(`betreiber_id`, `installation_id`),
	FOREIGN KEY (`betreiber_id`,`server_id`) REFERENCES `server`(`betreiber_id`,`server_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`betreiber_id`,`kunde_id`) REFERENCES `kunden`(`betreiber_id`,`kunde_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `installationen_server` ON `installationen` (`betreiber_id`,`server_id`);--> statement-breakpoint
-- drizzle-kit 0.31 writes the partial index's value as a bound parameter (?), which SQLite
-- refuses in a schema; the value from schema.ts, ne(t.zustand, "entfernt"), filled in by hand
CREATE UNIQUE INDEX `installationen_host` ON `installationen` (`betreiber_id`,`host`) WHERE "installationen"."zustand" <> 'entfernt';--> statement-breakpoint
CREATE TABLE `installations_ports` (
	`betreiber_id` text NOT NULL,
	`server_id` text NOT NULL,
	`port` integer NOT NULL,
	`installation_id` text NOT NULL,
	`zweck` text NOT NULL,
	PRIMARY KEY(`betreiber_id`, `server_id`, `port`),
	FOREIGN KEY (`betreiber_id`,`installation_id`) REFERENCES `installationen`(`betreiber_id`,`installation_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `installations_ports_installation` ON `installations_ports` (`betreiber_id`,`installation_id`);