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
CREATE TABLE `auftraege` (
	`betreiber_id` text NOT NULL,
	`auftrag_id` text NOT NULL,
	`server_id` text NOT NULL,
	`installation_id` text,
	`aktion` text NOT NULL,
	`app` text NOT NULL,
	`version` text NOT NULL,
	`manifest_hash` text NOT NULL,
	`manifest` text NOT NULL,
	`signatur` text NOT NULL,
	`argumente` text NOT NULL,
	`zeitlimit_s` integer NOT NULL,
	`zustand` text NOT NULL,
	`wartet_auf` text NOT NULL,
	`fortschritt` text,
	`fortschritt_am` integer,
	`ergebnis` text,
	`angelegt_von` text NOT NULL,
	`angelegt_am` integer NOT NULL,
	`geaendert_am` integer NOT NULL,
	PRIMARY KEY(`betreiber_id`, `auftrag_id`),
	FOREIGN KEY (`betreiber_id`,`server_id`) REFERENCES `server`(`betreiber_id`,`server_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `auftraege_server` ON `auftraege` (`betreiber_id`,`server_id`,`zustand`);--> statement-breakpoint
CREATE INDEX `auftraege_zustand` ON `auftraege` (`betreiber_id`,`zustand`);--> statement-breakpoint
CREATE TABLE `betreiber` (
	`betreiber_id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`angelegt_am` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `einladungen` (
	`betreiber_id` text NOT NULL,
	`einladung_id` text NOT NULL,
	`rolle` text NOT NULL,
	`gueltig_bis` integer NOT NULL,
	`angelegt_von` text NOT NULL,
	`angelegt_am` integer NOT NULL,
	`angenommen_von` text,
	`angenommen_am` integer,
	PRIMARY KEY(`betreiber_id`, `einladung_id`)
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
CREATE TABLE `fakten` (
	`betreiber_id` text NOT NULL,
	`server_id` text NOT NULL,
	`zeitpunkt` integer NOT NULL,
	`daten` text NOT NULL,
	PRIMARY KEY(`betreiber_id`, `server_id`, `zeitpunkt`)
);
--> statement-breakpoint
CREATE INDEX `fakten_zeitpunkt` ON `fakten` (`zeitpunkt`);--> statement-breakpoint
CREATE TABLE `geheimnisse` (
	`betreiber_id` text NOT NULL,
	`geheimnis_id` text NOT NULL,
	`zweck` text NOT NULL,
	`wert` text NOT NULL,
	`geaendert_am` integer NOT NULL,
	PRIMARY KEY(`betreiber_id`, `geheimnis_id`)
);
--> statement-breakpoint
CREATE TABLE `heartbeats` (
	`betreiber_id` text NOT NULL,
	`server_id` text NOT NULL,
	`zeitpunkt` integer NOT NULL,
	`daten` text NOT NULL,
	PRIMARY KEY(`betreiber_id`, `server_id`, `zeitpunkt`)
);
--> statement-breakpoint
CREATE INDEX `heartbeats_zeitpunkt` ON `heartbeats` (`zeitpunkt`);--> statement-breakpoint
CREATE TABLE `kunden` (
	`betreiber_id` text NOT NULL,
	`kunde_id` text NOT NULL,
	`name` text NOT NULL,
	`kontakt_name` text NOT NULL,
	`kontakt_email` text NOT NULL,
	`kontakt_telefon` text,
	`notiz` text,
	`kuerzel` text NOT NULL,
	`intern` integer DEFAULT false NOT NULL,
	`angelegt_am` integer NOT NULL,
	PRIMARY KEY(`betreiber_id`, `kunde_id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `kunden_kuerzel` ON `kunden` (`betreiber_id`,`kuerzel`);--> statement-breakpoint
CREATE TABLE `log_auszuege` (
	`betreiber_id` text NOT NULL,
	`auszug_id` text NOT NULL,
	`auftrag_id` text NOT NULL,
	`zeitpunkt` integer NOT NULL,
	`inhalt` text NOT NULL,
	PRIMARY KEY(`betreiber_id`, `auszug_id`)
);
--> statement-breakpoint
CREATE INDEX `log_auszuege_zeitpunkt` ON `log_auszuege` (`zeitpunkt`);--> statement-breakpoint
CREATE TABLE `mitglieder` (
	`betreiber_id` text NOT NULL,
	`nutzer_id` text NOT NULL,
	`rolle` text NOT NULL,
	`angelegt_am` integer NOT NULL,
	PRIMARY KEY(`betreiber_id`, `nutzer_id`)
);
--> statement-breakpoint
CREATE INDEX `mitglieder_nutzer` ON `mitglieder` (`nutzer_id`);--> statement-breakpoint
CREATE TABLE `server` (
	`betreiber_id` text NOT NULL,
	`server_id` text NOT NULL,
	`name` text NOT NULL,
	`wartungsfenster` text NOT NULL,
	`fingerabdruck` text,
	`zertifikat_gueltig_bis` integer,
	`fingerabdruck_neu` text,
	`zertifikat_neu_gueltig_bis` integer,
	`gesperrt_am` integer,
	`beigetreten_am` integer,
	`architektur` text,
	`agent_version` text,
	`fakten` text,
	`fakten_am` integer,
	`angelegt_von` text NOT NULL,
	`angelegt_am` integer NOT NULL,
	PRIMARY KEY(`betreiber_id`, `server_id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `server_fingerabdruck_unique` ON `server` (`fingerabdruck`);--> statement-breakpoint
CREATE UNIQUE INDEX `server_fingerabdruck_neu_unique` ON `server` (`fingerabdruck_neu`);--> statement-breakpoint
CREATE TABLE `tokens` (
	`betreiber_id` text NOT NULL,
	`token_id` text NOT NULL,
	`zweck` text NOT NULL,
	`hash` text NOT NULL,
	`gueltig_bis` integer,
	`angelegt_am` integer NOT NULL,
	PRIMARY KEY(`betreiber_id`, `token_id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tokens_hash_unique` ON `tokens` (`hash`);--> statement-breakpoint
CREATE TABLE `vertraege` (
	`betreiber_id` text NOT NULL,
	`vertrag_id` text NOT NULL,
	`kunde_id` text NOT NULL,
	`beginn` integer NOT NULL,
	`ende` integer,
	`angelegt_am` integer NOT NULL,
	PRIMARY KEY(`betreiber_id`, `vertrag_id`),
	FOREIGN KEY (`betreiber_id`,`kunde_id`) REFERENCES `kunden`(`betreiber_id`,`kunde_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `vertraege_kunde` ON `vertraege` (`betreiber_id`,`kunde_id`);--> statement-breakpoint
CREATE TABLE `abwicklungen` (
	`betreiber_id` text NOT NULL,
	`installation_id` text NOT NULL,
	`kunde_id` text NOT NULL,
	`vertragsende` integer NOT NULL,
	`schritt` text NOT NULL,
	`archiv_auftrag_id` text,
	`archiv` text,
	`loesch_auftrag_id` text,
	`versuche` integer DEFAULT 0 NOT NULL,
	`naechster_versuch` integer,
	`protokoll` text NOT NULL,
	`angelegt_am` integer NOT NULL,
	`geaendert_am` integer NOT NULL,
	`link_bis` integer,
	`geloescht_am` integer,
	PRIMARY KEY(`betreiber_id`, `installation_id`),
	FOREIGN KEY (`betreiber_id`,`installation_id`) REFERENCES `installationen`(`betreiber_id`,`installation_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `abwicklungen_kunde` ON `abwicklungen` (`betreiber_id`,`kunde_id`);--> statement-breakpoint
CREATE TABLE `aussen_pruefungen` (
	`betreiber_id` text NOT NULL,
	`installation_id` text NOT NULL,
	`zustand` text NOT NULL,
	`grund` text NOT NULL,
	`seit` integer NOT NULL,
	`geprueft_am` integer NOT NULL,
	`ergebnis` text NOT NULL,
	PRIMARY KEY(`betreiber_id`, `installation_id`),
	FOREIGN KEY (`betreiber_id`,`installation_id`) REFERENCES `installationen`(`betreiber_id`,`installation_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `verfuegbarkeit` (
	`betreiber_id` text NOT NULL,
	`installation_id` text NOT NULL,
	`stunde` integer NOT NULL,
	`gemessen` integer NOT NULL,
	`rot` integer NOT NULL,
	PRIMARY KEY(`betreiber_id`, `installation_id`, `stunde`),
	FOREIGN KEY (`betreiber_id`,`installation_id`) REFERENCES `installationen`(`betreiber_id`,`installation_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `verfuegbarkeit_stunde` ON `verfuegbarkeit` (`stunde`);--> statement-breakpoint
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
CREATE INDEX `backups_zeitpunkt` ON `backups` (`zeitpunkt`);--> statement-breakpoint
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
CREATE INDEX `pruef_restores_zeitpunkt` ON `pruef_restores` (`zeitpunkt`);--> statement-breakpoint
CREATE TABLE `wiederherstellungen` (
	`betreiber_id` text NOT NULL,
	`auftrag_id` text NOT NULL,
	`backup_auftrag_id` text NOT NULL,
	`installation_id` text NOT NULL,
	`server_id` text NOT NULL,
	`backup_id` text NOT NULL,
	`lauf_zeitpunkt` integer NOT NULL,
	`angefordert_am` integer NOT NULL,
	`ende_am` integer,
	`ok` integer,
	`fehler` text,
	`teile` text NOT NULL,
	`dauer_ms` integer,
	PRIMARY KEY(`betreiber_id`, `auftrag_id`),
	FOREIGN KEY (`betreiber_id`,`installation_id`) REFERENCES `installationen`(`betreiber_id`,`installation_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `wiederherstellungen_installation` ON `wiederherstellungen` (`betreiber_id`,`installation_id`,`angefordert_am`);--> statement-breakpoint
CREATE INDEX `wiederherstellungen_backup_auftrag` ON `wiederherstellungen` (`betreiber_id`,`backup_auftrag_id`);--> statement-breakpoint
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
CREATE INDEX `zustellungen_ereignis` ON `zustellungen` (`betreiber_id`,`ereignis_id`);--> statement-breakpoint
CREATE TABLE `dienst_innen` (
	`betreiber_id` text NOT NULL,
	`dienst_id` text NOT NULL,
	`bewertung` text NOT NULL,
	`grund` text NOT NULL,
	`seit` integer NOT NULL,
	`gemeldet_am` integer NOT NULL,
	`meldung` text NOT NULL,
	PRIMARY KEY(`betreiber_id`, `dienst_id`),
	FOREIGN KEY (`betreiber_id`,`dienst_id`) REFERENCES `dienste`(`betreiber_id`,`dienst_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `dienst_pruefungen` (
	`betreiber_id` text NOT NULL,
	`dienst_id` text NOT NULL,
	`zustand` text NOT NULL,
	`grund` text NOT NULL,
	`seit` integer NOT NULL,
	`geprueft_am` integer NOT NULL,
	`ergebnis` text NOT NULL,
	PRIMARY KEY(`betreiber_id`, `dienst_id`),
	FOREIGN KEY (`betreiber_id`,`dienst_id`) REFERENCES `dienste`(`betreiber_id`,`dienst_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `dienst_verfuegbarkeit` (
	`betreiber_id` text NOT NULL,
	`dienst_id` text NOT NULL,
	`stunde` integer NOT NULL,
	`gemessen` integer NOT NULL,
	`rot` integer NOT NULL,
	PRIMARY KEY(`betreiber_id`, `dienst_id`, `stunde`),
	FOREIGN KEY (`betreiber_id`,`dienst_id`) REFERENCES `dienste`(`betreiber_id`,`dienst_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `dienst_verfuegbarkeit_stunde` ON `dienst_verfuegbarkeit` (`stunde`);--> statement-breakpoint
CREATE TABLE `dienste` (
	`betreiber_id` text NOT NULL,
	`dienst_id` text NOT NULL,
	`name` text NOT NULL,
	`host` text NOT NULL,
	`pfad` text NOT NULL,
	`kunde_id` text,
	`angelegt_am` integer NOT NULL,
	`entfernt_am` integer,
	`server_id` text,
	`nutzer` text,
	`units` text,
	`health_port` integer,
	`health_pfad` text,
	PRIMARY KEY(`betreiber_id`, `dienst_id`),
	FOREIGN KEY (`betreiber_id`,`kunde_id`) REFERENCES `kunden`(`betreiber_id`,`kunde_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`betreiber_id`,`server_id`) REFERENCES `server`(`betreiber_id`,`server_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `dienste_server` ON `dienste` (`betreiber_id`,`server_id`);--> statement-breakpoint
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
CREATE TABLE `dns_einstellungen` (
	`betreiber_id` text PRIMARY KEY NOT NULL,
	`domain` text NOT NULL,
	`zone_id` text NOT NULL,
	`geaendert_am` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `installation_konfigurationen` (
	`betreiber_id` text NOT NULL,
	`auftrag_id` text NOT NULL,
	`installation_id` text NOT NULL,
	`einstellungen` text NOT NULL,
	`geheim` text NOT NULL,
	`angelegt_am` integer NOT NULL,
	PRIMARY KEY(`betreiber_id`, `auftrag_id`),
	FOREIGN KEY (`betreiber_id`,`installation_id`) REFERENCES `installationen`(`betreiber_id`,`installation_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `installation_konfigurationen_installation` ON `installation_konfigurationen` (`betreiber_id`,`installation_id`);--> statement-breakpoint
CREATE TABLE `installation_verlauf` (
	`betreiber_id` text NOT NULL,
	`installation_id` text NOT NULL,
	`zeitpunkt` integer NOT NULL,
	`bewertung` text NOT NULL,
	`grund` text NOT NULL,
	PRIMARY KEY(`betreiber_id`, `installation_id`, `zeitpunkt`),
	FOREIGN KEY (`betreiber_id`,`installation_id`) REFERENCES `installationen`(`betreiber_id`,`installation_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `installation_verlauf_zeitpunkt` ON `installation_verlauf` (`zeitpunkt`);--> statement-breakpoint
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
	`bewertung` text,
	`bewertung_grund` text,
	`bewertung_seit` integer,
	`gemeldet_am` integer,
	`meldung` text,
	`dns` text,
	`dns_versuche` integer DEFAULT 0 NOT NULL,
	`dns_naechster_versuch` integer,
	`angelegt_von` text NOT NULL,
	`angelegt_am` integer NOT NULL,
	`geaendert_am` integer NOT NULL,
	PRIMARY KEY(`betreiber_id`, `installation_id`),
	FOREIGN KEY (`betreiber_id`,`server_id`) REFERENCES `server`(`betreiber_id`,`server_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`betreiber_id`,`kunde_id`) REFERENCES `kunden`(`betreiber_id`,`kunde_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `installationen_server` ON `installationen` (`betreiber_id`,`server_id`);--> statement-breakpoint
CREATE INDEX `installationen_dns` ON `installationen` (`dns_naechster_versuch`);--> statement-breakpoint
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
CREATE INDEX `installations_ports_installation` ON `installations_ports` (`betreiber_id`,`installation_id`);--> statement-breakpoint
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
CREATE TABLE `updates` (
	`betreiber_id` text NOT NULL,
	`auftrag_id` text NOT NULL,
	`backup_auftrag_id` text NOT NULL,
	`installation_id` text NOT NULL,
	`server_id` text NOT NULL,
	`app` text NOT NULL,
	`von_version` text NOT NULL,
	`nach_version` text NOT NULL,
	`anlass` text NOT NULL,
	`welle` text,
	`sperrzeit_uebergangen` integer NOT NULL,
	`angefordert_am` integer NOT NULL,
	`ende_am` integer,
	`ergebnis` text,
	`fehler` text,
	`dauer_ms` integer,
	PRIMARY KEY(`betreiber_id`, `auftrag_id`),
	FOREIGN KEY (`betreiber_id`,`installation_id`) REFERENCES `installationen`(`betreiber_id`,`installation_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `updates_installation` ON `updates` (`betreiber_id`,`installation_id`,`angefordert_am`);--> statement-breakpoint
CREATE INDEX `updates_backup_auftrag` ON `updates` (`betreiber_id`,`backup_auftrag_id`);--> statement-breakpoint
CREATE INDEX `updates_version` ON `updates` (`betreiber_id`,`app`,`nach_version`);--> statement-breakpoint
CREATE TABLE `account` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`user_id` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`id_token` text,
	`access_token_expires_at` integer,
	`refresh_token_expires_at` integer,
	`scope` text,
	`password` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `account_user` ON `account` (`user_id`);--> statement-breakpoint
CREATE TABLE `invitation` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`email` text NOT NULL,
	`role` text,
	`status` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`inviter_id` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`inviter_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `member` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `member_organization` ON `member` (`organization_id`);--> statement-breakpoint
CREATE INDEX `member_user` ON `member` (`user_id`);--> statement-breakpoint
CREATE TABLE `organization` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`logo` text,
	`created_at` integer NOT NULL,
	`metadata` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `organization_slug_unique` ON `organization` (`slug`);--> statement-breakpoint
CREATE TABLE `passkey` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text,
	`public_key` text NOT NULL,
	`user_id` text NOT NULL,
	`credential_id` text NOT NULL,
	`counter` integer NOT NULL,
	`device_type` text NOT NULL,
	`backed_up` integer NOT NULL,
	`transports` text,
	`created_at` integer,
	`aaguid` text,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `passkey_user` ON `passkey` (`user_id`);--> statement-breakpoint
CREATE INDEX `passkey_credential` ON `passkey` (`credential_id`);--> statement-breakpoint
CREATE TABLE `session` (
	`id` text PRIMARY KEY NOT NULL,
	`expires_at` integer NOT NULL,
	`token` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`user_id` text NOT NULL,
	`active_organization_id` text,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_token_unique` ON `session` (`token`);--> statement-breakpoint
CREATE INDEX `session_user` ON `session` (`user_id`);--> statement-breakpoint
CREATE TABLE `two_factor` (
	`id` text PRIMARY KEY NOT NULL,
	`secret` text NOT NULL,
	`backup_codes` text NOT NULL,
	`user_id` text NOT NULL,
	`verified` integer DEFAULT true,
	`failed_verification_count` integer DEFAULT 0,
	`locked_until` integer,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `two_factor_user` ON `two_factor` (`user_id`);--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`email_verified` integer NOT NULL,
	`image` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`two_factor_enabled` integer DEFAULT false
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_email_unique` ON `user` (`email`);--> statement-breakpoint
CREATE TABLE `verification` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `verification_identifier` ON `verification` (`identifier`);