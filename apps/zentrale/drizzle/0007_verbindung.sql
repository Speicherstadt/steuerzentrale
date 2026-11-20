ALTER TABLE `server` ADD `fingerabdruck_neu` text;--> statement-breakpoint
ALTER TABLE `server` ADD `zertifikat_neu_gueltig_bis` integer;--> statement-breakpoint
ALTER TABLE `server` ADD `gesperrt_am` integer;--> statement-breakpoint
CREATE UNIQUE INDEX `server_fingerabdruck_neu_unique` ON `server` (`fingerabdruck_neu`);