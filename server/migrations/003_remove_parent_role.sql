-- The school decided parent/guardian accounts are not needed. Remove the role and its data model.
-- Accounts that were ONLY parents are disabled and soft-deleted (kept for audit history, cannot sign in).
DELETE FROM sessions WHERE user_id IN (SELECT user_id FROM parents);
DELETE FROM user_roles WHERE role_id = (SELECT id FROM roles WHERE key = 'parent');
UPDATE users SET status = 'disabled', deleted_at = now()
 WHERE id IN (SELECT user_id FROM parents)
   AND NOT EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id = users.id);
DROP TABLE guardian_student_relationships;
DROP TABLE parents;
DELETE FROM role_permissions
 WHERE role_id = (SELECT id FROM roles WHERE key = 'parent')
    OR permission_id = (SELECT id FROM permissions WHERE key = 'self.children');
DELETE FROM roles WHERE key = 'parent';
DELETE FROM permissions WHERE key = 'self.children';
INSERT INTO audit_logs (action, entity_type, details) VALUES ('system.parent_role_removed', 'system', '{"migration":"003"}');
