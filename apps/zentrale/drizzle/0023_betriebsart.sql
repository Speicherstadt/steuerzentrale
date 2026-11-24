ALTER TABLE `betreiber` ADD `betriebsart` text;--> statement-breakpoint
ALTER TABLE `betreiber` ADD `eigener_kunde_id` text;--> statement-breakpoint
UPDATE `betreiber` SET `betriebsart` = 'kunden';