CREATE TABLE `dns_einstellungen` (
	`betreiber_id` text PRIMARY KEY NOT NULL,
	`domain` text NOT NULL,
	`zone_id` text NOT NULL,
	`geaendert_am` integer NOT NULL
);
--> statement-breakpoint
-- Z-407: every customer gets a short name, for those there already one from its name like
-- kuerzelVorschlag in packages/manifest/src/adresse.ts: lower case, umlauts spelled out, every
-- other sign a hyphen (SQLite has no regular expressions, so character by character), runs of
-- hyphens as one, cut to 30, `kunde` when nothing is left; a name taken in the same operator gets
-- the start of the customer's id
ALTER TABLE `kunden` ADD `kuerzel` text DEFAULT '' NOT NULL;--> statement-breakpoint
UPDATE `kunden` SET `kuerzel` = (
	WITH RECURSIVE `z`(`i`, `n`, `aus`) AS (
		SELECT 1, replace(replace(replace(replace(replace(replace(replace(lower(`kunden`.`name`), 'ä', 'ae'), 'ö', 'oe'), 'ü', 'ue'), 'Ä', 'ae'), 'Ö', 'oe'), 'Ü', 'ue'), 'ß', 'ss'), ''
		UNION ALL
		SELECT `i` + 1, `n`, `aus` || CASE WHEN substr(`n`, `i`, 1) GLOB '[a-z0-9]' THEN substr(`n`, `i`, 1) ELSE '-' END FROM `z` WHERE `i` <= length(`n`)
	) SELECT `aus` FROM `z` ORDER BY `i` DESC LIMIT 1
);--> statement-breakpoint
UPDATE `kunden` SET `kuerzel` = replace(replace(replace(replace(replace(replace(replace(replace(`kuerzel`, '--', '-'), '--', '-'), '--', '-'), '--', '-'), '--', '-'), '--', '-'), '--', '-'), '--', '-');--> statement-breakpoint
UPDATE `kunden` SET `kuerzel` = trim(substr(trim(`kuerzel`, '-'), 1, 30), '-');--> statement-breakpoint
UPDATE `kunden` SET `kuerzel` = 'kunde' WHERE `kuerzel` = '';--> statement-breakpoint
UPDATE `kunden` SET `kuerzel` = rtrim(substr(`kuerzel`, 1, 21), '-') || '-' || substr(`kunde_id`, 1, 8) WHERE EXISTS (
	SELECT 1 FROM `kunden` AS `k` WHERE `k`.`betreiber_id` = `kunden`.`betreiber_id` AND `k`.`kuerzel` = `kunden`.`kuerzel` AND `k`.`rowid` < `kunden`.`rowid`
);--> statement-breakpoint
CREATE UNIQUE INDEX `kunden_kuerzel` ON `kunden` (`betreiber_id`,`kuerzel`);--> statement-breakpoint
ALTER TABLE `installationen` ADD `dns` text;--> statement-breakpoint
ALTER TABLE `installationen` ADD `dns_versuche` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `installationen` ADD `dns_naechster_versuch` integer;--> statement-breakpoint
CREATE INDEX `installationen_dns` ON `installationen` (`dns_naechster_versuch`);
