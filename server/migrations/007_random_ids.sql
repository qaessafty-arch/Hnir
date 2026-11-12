-- Student IDs become DAR + 4 random digits (DAR-4821), at the school's request, so they are not sequential.
-- Existing students are renumbered once; their sign-in username follows. Staff codes are 4 random digits too
-- (issued by the application; one 4-digit space shared by students and staff, so they can never collide).
DO $$
BEGIN
  IF (SELECT count(*) FROM students) > 9000 THEN
    RAISE EXCEPTION 'More than 9000 students: 4-digit random IDs are not possible';
  END IF;
END $$;

UPDATE students SET student_no = 'TMP-' || id;
UPDATE users u SET username = 'TMP-U' || u.id FROM students s WHERE s.user_id = u.id;

WITH s AS (SELECT id, row_number() OVER (ORDER BY id) AS rn FROM students),
     n AS (SELECT g, row_number() OVER (ORDER BY random()) AS rn FROM generate_series(1000, 9999) AS g)
UPDATE students st SET student_no = 'DAR-' || n.g
  FROM s JOIN n ON n.rn = s.rn WHERE st.id = s.id;

UPDATE users u SET username = s.student_no FROM students s WHERE s.user_id = u.id;

INSERT INTO audit_logs (action, entity_type, details)
VALUES ('system.student_ids_randomised', 'system', jsonb_build_object('migration', '007', 'students', (SELECT count(*) FROM students)));
