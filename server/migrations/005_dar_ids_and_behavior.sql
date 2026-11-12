-- 1) Permanent student IDs in DAR-0001 format (student usernames follow the ID).
WITH numbered AS (SELECT id, 'DAR-' || lpad((row_number() OVER (ORDER BY id))::text, 4, '0') AS no FROM students)
UPDATE students s SET student_no = n.no FROM numbered n WHERE s.id = n.id;
UPDATE users u SET username = s.student_no FROM students s WHERE s.user_id = u.id;
SELECT setval('student_no_seq', (SELECT count(*) FROM students) + 1, false);

-- 2) Weekly behavior evaluations (managed by the principal or the class's homeroom teacher).
CREATE TABLE behavior_evaluations (
  id          bigserial PRIMARY KEY,
  student_id  bigint  NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  term_id     integer NOT NULL REFERENCES terms(id) ON DELETE RESTRICT,
  week_no     smallint NOT NULL CHECK (week_no BETWEEN 1 AND 60),
  rating      text NOT NULL CHECK (rating IN ('excellent','very_good','good','average','needs_improvement')),
  comment     text CHECK (comment IS NULL OR length(comment) <= 300),
  status      text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')),
  entered_by  bigint REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (student_id, term_id, week_no)
);
CREATE INDEX behavior_lookup_idx ON behavior_evaluations (term_id, week_no);

CREATE TABLE behavior_history (
  id             bigserial PRIMARY KEY,
  evaluation_id  bigint NOT NULL REFERENCES behavior_evaluations(id) ON DELETE CASCADE,
  old_rating     text, new_rating text, old_status text, new_status text,
  changed_by     bigint REFERENCES users(id),
  changed_at     timestamptz NOT NULL DEFAULT now()
);

INSERT INTO audit_logs (action, entity_type, details) VALUES ('system.student_ids_renumbered', 'system', '{"format":"DAR-0001","migration":"005"}');
