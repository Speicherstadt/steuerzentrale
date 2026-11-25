-- The audit log is append-only: no row may be changed or removed, not even by the Zentrale itself
CREATE TRIGGER `audit_log_kein_aendern` BEFORE UPDATE ON `audit_log`
BEGIN
	SELECT RAISE(ABORT, 'audit_log is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `audit_log_kein_loeschen` BEFORE DELETE ON `audit_log`
BEGIN
	SELECT RAISE(ABORT, 'audit_log is append-only');
END;
--> statement-breakpoint
-- An imported version never changes (docs/plan.md, "Manifeste in der Zentrale (Z-501)"); a second
-- import with other content is refused before it gets here, these refuse any other way
CREATE TRIGGER `manifeste_kein_aendern` BEFORE UPDATE ON `manifeste`
BEGIN
	SELECT RAISE(ABORT, 'manifeste are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `manifeste_kein_loeschen` BEFORE DELETE ON `manifeste`
BEGIN
	SELECT RAISE(ABORT, 'manifeste are immutable');
END;
