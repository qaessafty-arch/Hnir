-- Reference data required by the application (not demo data).

INSERT INTO roles (key, name_en, name_ckb, is_privileged) VALUES
  ('super_admin', 'Super Administrator', 'بەڕێوەبەری باڵا', true),
  ('principal',   'Principal',           'بەڕێوەبەری قوتابخانە', true),
  ('registrar',   'Registrar',           'تۆمارکار', true),
  ('teacher',     'Teacher',             'مامۆستا', false),
  ('student',     'Student',             'قوتابی', false),
  ('parent',      'Parent / Guardian',   'دایک و باوک / سەرپەرشتیار', false),
  ('auditor',     'Auditor (read-only)', 'وردبین (تەنها خوێندنەوە)', true);

INSERT INTO permissions (key, description) VALUES
  ('system.settings',   'Change system settings and grading policy'),
  ('roles.manage',      'Assign any role including administrators'),
  ('users.manage',      'Create, disable and reset staff/parent accounts'),
  ('academic.manage',   'Manage academic years, terms, sections, subjects'),
  ('backups.manage',    'View backup status'),
  ('dashboard.school',  'View school-wide dashboard'),
  ('students.read',     'View all student records'),
  ('students.write',    'Create and edit students and enrollments'),
  ('students.archive',  'Archive / transfer students'),
  ('students.import',   'Bulk-import students'),
  ('teachers.read',     'View teachers'),
  ('teachers.write',    'Create and edit teachers'),
  ('assignments.manage','Assign teachers to sections and subjects'),
  ('grades.enter',      'Enter grades for own assigned classes'),
  ('grades.read_all',   'View all grades school-wide'),
  ('grades.manage_all', 'Enter/edit grades for any class before publication'),
  ('grades.approve',    'Approve or return submitted grades'),
  ('grades.publish',    'Publish approved grades to students'),
  ('grades.correct',    'Correct published grades (reason required)'),
  ('reports.school',    'School-wide reports'),
  ('reports.class',     'Reports for own assigned classes'),
  ('exports.csv',       'Export CSV files'),
  ('audit.read',        'Read audit logs'),
  ('self.grades',       'Student: view own published grades'),
  ('self.children',     'Parent: view verified linked children');

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON
  (r.key = 'super_admin' AND p.key NOT IN ('self.grades','self.children','grades.enter'))
  OR (r.key = 'principal' AND p.key IN ('users.manage','dashboard.school','students.read','students.write',
      'students.archive','students.import','teachers.read','teachers.write','assignments.manage',
      'grades.read_all','grades.manage_all','grades.approve','grades.publish','grades.correct',
      'reports.school','exports.csv','audit.read','academic.manage'))
  OR (r.key = 'registrar' AND p.key IN ('dashboard.school','students.read','students.write','students.archive',
      'students.import','teachers.read','exports.csv'))
  OR (r.key = 'teacher' AND p.key IN ('grades.enter','reports.class'))
  OR (r.key = 'student' AND p.key IN ('self.grades'))
  OR (r.key = 'parent'  AND p.key IN ('self.children'))
  OR (r.key = 'auditor' AND p.key IN ('dashboard.school','students.read','teachers.read','grades.read_all',
      'reports.school','audit.read'));

INSERT INTO classes (grade_level, name_en, name_ckb)
SELECT g, 'Grade ' || g, 'پۆلی ' || g FROM generate_series(1, 12) g;

-- The 13 subjects from the original system, preserved with their default maximum (10).
INSERT INTO subjects (code, name_ckb, name_en, default_max_score, pass_mark_percent, sort_order) VALUES
  ('BEH', 'ڕەفتار',      'Behavior',      10, 50, 1),
  ('ENG', 'ئینگلیزی',    'English',       10, 50, 2),
  ('MTH', 'بیرکاری',     'Math',          10, 50, 3),
  ('SCI', 'زانست',       'Science',       10, 50, 4),
  ('KUR', 'کوردی',       'Kurdish',       10, 50, 5),
  ('REL', 'ئاین',        'Religion',      10, 50, 6),
  ('ARA', 'عەرەبی',      'Arabic',        10, 50, 7),
  ('SOC', 'کۆمەڵایەتی',  'Social',        10, 50, 8),
  ('VAL', 'بەهاکان',     'Social Values', 10, 50, 9),
  ('ICT', 'ئایتی',       'IT',            10, 50, 10),
  ('ART', 'هونەر',       'Art',           10, 50, 11),
  ('PE',  'وەرزش',       'Sport',         10, 50, 12),
  ('MUS', 'مۆزیک',       'Music',         10, 50, 13);

INSERT INTO assessment_categories (code, name_en, name_ckb, weight) VALUES
  ('weekly',   'Weekly assessment', 'هەڵسەنگاندنی هەفتانە', 1),
  ('quiz',     'Quiz',              'تاقیکردنەوەی کورت',   1),
  ('homework', 'Homework',          'ئەرکی ماڵەوە',        1),
  ('exam',     'Exam',              'تاقیکردنەوە',         1);

INSERT INTO system_settings (key, value) VALUES
  ('school', '{"name_en":"Darwaza Private School","name_ckb":"قوتابخانەی دەروازەی ناحکومی","founded":2019}'),
  ('grading', '{"mode":"weighted","allow_decimals":true,"decimal_places":2,"display_decimals":1,"rounding":"half_up","missing_counts_as_zero":true,"bands":[{"min":90,"key":"excellent"},{"min":75,"key":"very_good"},{"min":60,"key":"good"},{"min":50,"key":"pass"},{"min":0,"key":"needs_improvement"}]}'),
  ('security', '{"mfa_required_roles":["super_admin","principal"],"session_idle_minutes":30,"session_absolute_hours":12,"max_failed_logins":5,"lockout_minutes":15}');
