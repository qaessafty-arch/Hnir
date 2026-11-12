-- Sign-in by code only (no passwords), at the school's request.
--   Students: their permanent student ID (DAR-0001).
--   Staff: a personal secret sign-in code issued by an administrator. Only its SHA-256 is stored.
ALTER TABLE users ADD COLUMN login_code_hash text UNIQUE;
ALTER TABLE users ADD COLUMN login_code_set_at timestamptz;
-- Passwords are no longer used; nobody should be stuck on a "change your password" screen.
UPDATE users SET must_change_password = false WHERE must_change_password;
INSERT INTO audit_logs (action, entity_type, details) VALUES ('system.code_login_enabled', 'system', '{"migration":"006"}');
