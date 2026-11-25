-- Z-1204: two roles. technik becomes inhaber, support becomes mitglied, in the Zentrale's mirror and
-- in Better Auth's member. An invitation not yet accepted gets the least rights: both old roles
-- become mitglied, so a link sent before the update grants no owner's rights.
UPDATE `mitglieder` SET `rolle` = 'inhaber' WHERE `rolle` = 'technik';--> statement-breakpoint
UPDATE `mitglieder` SET `rolle` = 'mitglied' WHERE `rolle` = 'support';--> statement-breakpoint
UPDATE `member` SET `role` = 'inhaber' WHERE `role` = 'technik';--> statement-breakpoint
UPDATE `member` SET `role` = 'mitglied' WHERE `role` = 'support';--> statement-breakpoint
UPDATE `einladungen` SET `rolle` = 'mitglied' WHERE `rolle` IN ('technik', 'support');--> statement-breakpoint
UPDATE `invitation` SET `role` = 'mitglied' WHERE `role` IN ('technik', 'support');
