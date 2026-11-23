CREATE TABLE `manifeste` (
	`app` text NOT NULL,
	`version` text NOT NULL,
	`text` text NOT NULL,
	`signatur` text NOT NULL,
	`sha256` text NOT NULL,
	`dringend` integer NOT NULL,
	`importiert_am` integer NOT NULL,
	`importiert_von` text NOT NULL,
	`importiert_von_betreiber` text,
	PRIMARY KEY(`app`, `version`)
);
--> statement-breakpoint
ALTER TABLE `kunden` ADD `intern` integer DEFAULT false NOT NULL;--> statement-breakpoint
-- Z-501: an imported version never changes (docs/plan.md, "Manifeste in der Zentrale (Z-501)"); a
-- second import with other content is refused before it gets here, these refuse any other way
CREATE TRIGGER `manifeste_kein_aendern` BEFORE UPDATE ON `manifeste`
BEGIN
	SELECT RAISE(ABORT, 'manifeste are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `manifeste_kein_loeschen` BEFORE DELETE ON `manifeste`
BEGIN
	SELECT RAISE(ABORT, 'manifeste are immutable');
END;
