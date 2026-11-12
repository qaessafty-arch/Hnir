-- Darwaza Private School — initial schema
-- All timestamps are timestamptz (UTC). Soft deletion via deleted_at / status where records
-- must be retained for academic history.

CREATE TABLE roles (
  id          smallserial PRIMARY KEY,
  key         text NOT NULL UNIQUE,
  name_en     text NOT NULL,
  name_ckb    text NOT NULL,
  is_privileged boolean NOT NULL DEFAULT false
);

CREATE TABLE permissions (
  id          smallserial PRIMARY KEY,
  key         text NOT NULL UNIQUE,
  description text NOT NULL
);

CREATE TABLE role_permissions (
  role_id       smallint NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id smallint NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE users (
  id                    bigserial PRIMARY KEY,
  username              text NOT NULL,
  email                 text,
  full_name             text NOT NULL,
  password_hash         text NOT NULL,
  status                text NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  must_change_password  boolean NOT NULL DEFAULT true,
  mfa_secret_enc        text,
  mfa_enabled           boolean NOT NULL DEFAULT false,
  failed_login_count    integer NOT NULL DEFAULT 0,
  locked_until          timestamptz,
  last_login_at         timestamptz,
  preferred_lang        text NOT NULL DEFAULT 'ckb' CHECK (preferred_lang IN ('ckb','en')),
  password_changed_at   timestamptz NOT NULL DEFAULT now(),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  deleted_at            timestamptz
);
CREATE UNIQUE INDEX users_username_uq ON users (lower(username));
CREATE UNIQUE INDEX users_email_uq ON users (lower(email)) WHERE email IS NOT NULL;

CREATE TABLE user_roles (
  user_id bigint   NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id smallint NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
  PRIMARY KEY (user_id, role_id)
);
CREATE INDEX user_roles_role_idx ON user_roles (role_id);

-- Server-side sessions. Only the SHA-256 of the cookie token is stored.
CREATE TABLE sessions (
  id            text PRIMARY KEY,
  user_id       bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf_token    text NOT NULL,
  mfa_state     text NOT NULL DEFAULT 'none' CHECK (mfa_state IN ('none','pending_verify','pending_enroll','verified')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  ip            text,
  user_agent    text
);
CREATE INDEX sessions_user_idx ON sessions (user_id);
CREATE INDEX sessions_expires_idx ON sessions (expires_at);

CREATE TABLE password_reset_tokens (
  id          bigserial PRIMARY KEY,
  user_id     bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  text NOT NULL UNIQUE,
  created_by  bigint REFERENCES users(id),
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE academic_years (
  id          serial PRIMARY KEY,
  name        text NOT NULL UNIQUE,
  starts_on   date NOT NULL,
  ends_on     date NOT NULL,
  is_current  boolean NOT NULL DEFAULT false,
  status      text NOT NULL DEFAULT 'active' CHECK (status IN ('planned','active','closed')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_on > starts_on)
);
CREATE UNIQUE INDEX academic_years_one_current ON academic_years (is_current) WHERE is_current;

CREATE TABLE terms (
  id                serial PRIMARY KEY,
  academic_year_id  integer NOT NULL REFERENCES academic_years(id) ON DELETE RESTRICT,
  name_en           text NOT NULL,
  name_ckb          text NOT NULL,
  ordinal           smallint NOT NULL,
  starts_on         date NOT NULL,
  ends_on           date NOT NULL,
  grade_entry_open  boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (academic_year_id, ordinal),
  CHECK (ends_on > starts_on)
);

-- Grade levels (1..12). "classes" in the brief.
CREATE TABLE classes (
  id           serial PRIMARY KEY,
  grade_level  smallint NOT NULL UNIQUE CHECK (grade_level BETWEEN 1 AND 12),
  name_en      text NOT NULL,
  name_ckb     text NOT NULL
);

CREATE TABLE teachers (
  id          bigserial PRIMARY KEY,
  user_id     bigint NOT NULL UNIQUE REFERENCES users(id) ON DELETE RESTRICT,
  staff_no    text NOT NULL UNIQUE,
  phone       text,
  status      text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Sections are per academic year (e.g. Grade 10 – A, 2026-2027)
CREATE TABLE sections (
  id                  serial PRIMARY KEY,
  class_id            integer NOT NULL REFERENCES classes(id) ON DELETE RESTRICT,
  academic_year_id    integer NOT NULL REFERENCES academic_years(id) ON DELETE RESTRICT,
  name                text NOT NULL,
  homeroom_teacher_id bigint REFERENCES teachers(id) ON DELETE SET NULL,
  capacity            smallint CHECK (capacity IS NULL OR capacity > 0),
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (class_id, academic_year_id, name)
);
CREATE INDEX sections_year_idx ON sections (academic_year_id);

CREATE TABLE subjects (
  id                 serial PRIMARY KEY,
  code               text NOT NULL UNIQUE,
  name_en            text NOT NULL,
  name_ckb           text NOT NULL,
  default_max_score  numeric(6,2) NOT NULL DEFAULT 10 CHECK (default_max_score > 0),
  pass_mark_percent  numeric(5,2) NOT NULL DEFAULT 50 CHECK (pass_mark_percent BETWEEN 0 AND 100),
  sort_order         smallint NOT NULL DEFAULT 0,
  is_active          boolean NOT NULL DEFAULT true,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE students (
  id             bigserial PRIMARY KEY,
  user_id        bigint UNIQUE REFERENCES users(id) ON DELETE SET NULL,
  student_no     text NOT NULL UNIQUE,
  full_name_ckb  text NOT NULL,
  full_name_en   text,
  date_of_birth  date,
  gender         text CHECK (gender IN ('male','female')),
  photo_path     text,
  guardian_name  text,
  guardian_phone text,
  address        text,
  status         text NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived','transferred','graduated')),
  status_reason  text,
  legacy_code    text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX students_status_idx ON students (status);
CREATE INDEX students_name_ckb_idx ON students (lower(full_name_ckb));
CREATE INDEX students_name_en_idx ON students (lower(full_name_en));

CREATE TABLE parents (
  id          bigserial PRIMARY KEY,
  user_id     bigint NOT NULL UNIQUE REFERENCES users(id) ON DELETE RESTRICT,
  phone       text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE guardian_student_relationships (
  parent_id     bigint NOT NULL REFERENCES parents(id) ON DELETE CASCADE,
  student_id    bigint NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  relationship  text NOT NULL DEFAULT 'guardian',
  verified_at   timestamptz,
  verified_by   bigint REFERENCES users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (parent_id, student_id)
);
CREATE INDEX gsr_student_idx ON guardian_student_relationships (student_id);

CREATE TABLE enrollments (
  id                bigserial PRIMARY KEY,
  student_id        bigint  NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  section_id        integer NOT NULL REFERENCES sections(id) ON DELETE RESTRICT,
  academic_year_id  integer NOT NULL REFERENCES academic_years(id) ON DELETE RESTRICT,
  status            text NOT NULL DEFAULT 'active' CHECK (status IN ('active','withdrawn','completed')),
  enrolled_on       date NOT NULL DEFAULT current_date,
  left_on           date,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (student_id, academic_year_id)
);
CREATE INDEX enrollments_section_idx ON enrollments (section_id, status);

CREATE TABLE teacher_assignments (
  id                bigserial PRIMARY KEY,
  teacher_id        bigint  NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  section_id        integer NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
  subject_id        integer NOT NULL REFERENCES subjects(id) ON DELETE RESTRICT,
  academic_year_id  integer NOT NULL REFERENCES academic_years(id) ON DELETE RESTRICT,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (teacher_id, section_id, subject_id)
);
CREATE INDEX ta_section_subject_idx ON teacher_assignments (section_id, subject_id);

CREATE TABLE assessment_categories (
  id        serial PRIMARY KEY,
  code      text NOT NULL UNIQUE,
  name_en   text NOT NULL,
  name_ckb  text NOT NULL,
  weight    numeric(6,2) NOT NULL DEFAULT 1 CHECK (weight >= 0)
);

-- One assessment = one grade sheet for one section + subject (e.g. "Week 3 quiz").
CREATE TABLE assessments (
  id            bigserial PRIMARY KEY,
  term_id       integer NOT NULL REFERENCES terms(id) ON DELETE RESTRICT,
  section_id    integer NOT NULL REFERENCES sections(id) ON DELETE RESTRICT,
  subject_id    integer NOT NULL REFERENCES subjects(id) ON DELETE RESTRICT,
  category_id   integer NOT NULL REFERENCES assessment_categories(id) ON DELETE RESTRICT,
  title         text NOT NULL,
  week_no       smallint CHECK (week_no IS NULL OR week_no BETWEEN 1 AND 60),
  max_score     numeric(6,2) NOT NULL CHECK (max_score > 0),
  assessed_on   date,
  status        text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted','approved','published','returned')),
  version       integer NOT NULL DEFAULT 1,
  created_by    bigint REFERENCES users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (term_id, section_id, subject_id, title)
);
CREATE INDEX assessments_lookup_idx ON assessments (section_id, subject_id, term_id);
CREATE INDEX assessments_status_idx ON assessments (status);

CREATE TABLE grade_records (
  id             bigserial PRIMARY KEY,
  assessment_id  bigint NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
  student_id     bigint NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  score          numeric(6,2) CHECK (score IS NULL OR score >= 0),
  status         text NOT NULL DEFAULT 'graded' CHECK (status IN ('graded','missing','excused')),
  comment        text CHECK (comment IS NULL OR length(comment) <= 500),
  version        integer NOT NULL DEFAULT 1,
  entered_by     bigint REFERENCES users(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (assessment_id, student_id),
  CHECK ((status = 'graded' AND score IS NOT NULL) OR (status <> 'graded' AND score IS NULL))
);
CREATE INDEX grade_records_student_idx ON grade_records (student_id);

-- Every change to a grade after creation (including corrections with reasons).
CREATE TABLE grade_record_history (
  id              bigserial PRIMARY KEY,
  grade_record_id bigint NOT NULL REFERENCES grade_records(id) ON DELETE CASCADE,
  old_score       numeric(6,2),
  new_score       numeric(6,2),
  old_status      text,
  new_status      text,
  reason          text,
  is_correction   boolean NOT NULL DEFAULT false,
  changed_by      bigint REFERENCES users(id),
  changed_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX grh_record_idx ON grade_record_history (grade_record_id);

CREATE TABLE grade_approvals (
  id             bigserial PRIMARY KEY,
  assessment_id  bigint NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
  action         text NOT NULL CHECK (action IN ('submit','approve','return','publish','unpublish','correct')),
  from_status    text NOT NULL,
  to_status      text NOT NULL,
  comment        text,
  acted_by       bigint NOT NULL REFERENCES users(id),
  acted_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX grade_approvals_assessment_idx ON grade_approvals (assessment_id);

CREATE TABLE audit_logs (
  id           bigserial PRIMARY KEY,
  actor_user_id bigint REFERENCES users(id) ON DELETE SET NULL,
  action       text NOT NULL,
  entity_type  text,
  entity_id    text,
  details      jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip           text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_created_idx ON audit_logs (created_at DESC);
CREATE INDEX audit_logs_actor_idx ON audit_logs (actor_user_id, created_at DESC);
CREATE INDEX audit_logs_entity_idx ON audit_logs (entity_type, entity_id);

-- Audit log is append-only.
CREATE FUNCTION audit_logs_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER audit_logs_no_update BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_logs_immutable();

CREATE TABLE notifications (
  id          bigserial PRIMARY KEY,
  user_id     bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind        text NOT NULL,
  payload     jsonb NOT NULL DEFAULT '{}'::jsonb,
  read_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_user_idx ON notifications (user_id, read_at, created_at DESC);

CREATE TABLE system_settings (
  key         text PRIMARY KEY,
  value       jsonb NOT NULL,
  updated_by  bigint REFERENCES users(id),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE SEQUENCE student_no_seq START 1;
CREATE SEQUENCE staff_no_seq START 1;
