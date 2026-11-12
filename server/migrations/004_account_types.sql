-- Account types (roles) become configurable by the super administrator:
-- built-in vs custom types, active/suspended, optional description.
ALTER TABLE roles ADD COLUMN is_system boolean NOT NULL DEFAULT false;
ALTER TABLE roles ADD COLUMN is_active boolean NOT NULL DEFAULT true;
ALTER TABLE roles ADD COLUMN description text;
UPDATE roles SET is_system = true;
