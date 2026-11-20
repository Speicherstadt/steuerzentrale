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
