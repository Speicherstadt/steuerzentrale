-- Z-1204: two roles. technik becomes inhaber, support becomes mitglied, in the Zentrale's mirror,
-- in Better Auth's member and in open invitations of both.
UPDATE `mitglieder` SET `rolle` = 'inhaber' WHERE `rolle` = 'technik';--> statement-breakpoint
UPDATE `mitglieder` SET `rolle` = 'mitglied' WHERE `rolle` = 'support';--> statement-breakpoint
UPDATE `member` SET `role` = 'inhaber' WHERE `role` = 'technik';--> statement-breakpoint
UPDATE `member` SET `role` = 'mitglied' WHERE `role` = 'support';--> statement-breakpoint
UPDATE `einladungen` SET `rolle` = 'inhaber' WHERE `rolle` = 'technik';--> statement-breakpoint
UPDATE `einladungen` SET `rolle` = 'mitglied' WHERE `rolle` = 'support';--> statement-breakpoint
UPDATE `invitation` SET `role` = 'inhaber' WHERE `role` = 'technik';--> statement-breakpoint
UPDATE `invitation` SET `role` = 'mitglied' WHERE `role` = 'support';
