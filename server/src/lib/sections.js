'use strict';
/**
 * Sections of the application, as the super administrator sees them, and the permissions each access
 * level grants. The server stores permissions; this file is the single translation table, so "hiding a
 * section" also removes the API rights behind it (not just the menu item).
 */
const SECTIONS = [
  { key: 'home',      levels: { view: ['dashboard.school'] } },
  { key: 'approvals', levels: { manage: ['grades.approve', 'grades.publish'] } },
  { key: 'myclasses', levels: { manage: ['grades.enter', 'reports.class'] } },
  { key: 'grades',    levels: { view: ['grades.read_all'], manage: ['grades.read_all', 'grades.manage_all', 'grades.correct'] } },
  { key: 'students',  levels: { view: ['students.read'], manage: ['students.read', 'students.write', 'students.archive', 'students.import'] } },
  { key: 'results',   levels: { view: ['reports.school'], manage: ['reports.school', 'exports.csv'] } },
  { key: 'staff',     levels: { view: ['teachers.read'], manage: ['teachers.read', 'teachers.write', 'assignments.manage', 'users.manage'] } },
  { key: 'setup',     levels: { manage: ['academic.manage'] } },
  { key: 'activity',  levels: { view: ['audit.read'] } },
];
// Never configurable: only the super administrator holds these.
const RESERVED = ['system.settings', 'roles.manage', 'backups.manage'];
const LOCKED_ROLES = ['super_admin', 'student'];

function levelsFromPermissions(perms) {
  const has = (list) => list.every((p) => perms.has(p));
  const out = {};
  for (const s of SECTIONS) {
    out[s.key] = s.levels.manage && has(s.levels.manage) ? 'manage' : s.levels.view && has(s.levels.view) ? 'view' : 'hidden';
  }
  return out;
}

function permissionsFromLevels(levels) {
  const set = new Set();
  for (const s of SECTIONS) {
    const lvl = levels[s.key];
    if (lvl === 'hidden' || !lvl) continue;
    const perms = s.levels[lvl];
    if (!perms) throw Object.assign(new Error(`invalid level ${lvl} for ${s.key}`), { code: 'invalid_level' });
    perms.forEach((p) => set.add(p));
  }
  return [...set];
}

module.exports = { SECTIONS, RESERVED, LOCKED_ROLES, levelsFromPermissions, permissionsFromLevels };
