import 'dotenv/config';
import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import fs from 'fs';
import path from 'path';
import { FIELD_CATALOG } from '../shared/fieldCatalog.ts';
import {
  INITIAL_DROPDOWN_LISTS,
  INITIAL_LOCATION_TO_SITES,
  INITIAL_REGION_TO_LOCATIONS,
  INITIAL_SUB_SOURCE_MAPPING,
} from '../shared/seedData.ts';
import { DropdownConfigBundle } from '../shared/validation.ts';

const dbFilePath = process.env.DB_PATH || path.join(process.cwd(), 'data', 'app.sqlite');
const dbDir = path.dirname(dbFilePath);

if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

export const db = new Database(dbFilePath);

// Mandatory SQLite settings: WAL mode and foreign keys ON
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('synchronous = NORMAL');

export function initDatabase(): void {
  // 1. Users table
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('admin', 'pic')),
      pic_code TEXT NOT NULL DEFAULT '',
      full_name TEXT NOT NULL DEFAULT '',
      must_change_password INTEGER NOT NULL DEFAULT 1,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );
  `);

  // 2. Sessions table
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);

  // 3. Candidates table with all 61 fields + id + row_version + is_archived + updated_at
  const fieldColumnsSql = FIELD_CATALOG.map((f) => {
    if (f.key === 'candidate_code') {
      return `candidate_code TEXT NOT NULL UNIQUE`;
    }
    return `${f.key} TEXT NOT NULL DEFAULT ''`;
  }).join(',\n      ');

  db.exec(`
    CREATE TABLE IF NOT EXISTS candidates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      row_version INTEGER NOT NULL DEFAULT 1,
      is_archived INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT '',
      ${fieldColumnsSql}
    );
    CREATE INDEX IF NOT EXISTS idx_candidates_phone ON candidates(phone);
    CREATE INDEX IF NOT EXISTS idx_candidates_pic ON candidates(pic);
    CREATE INDEX IF NOT EXISTS idx_candidates_position ON candidates(position);
    CREATE INDEX IF NOT EXISTS idx_candidates_site ON candidates(site);
    CREATE INDEX IF NOT EXISTS idx_candidates_source ON candidates(source);
    CREATE INDEX IF NOT EXISTS idx_candidates_ob_month ON candidates(ob_month);
    CREATE INDEX IF NOT EXISTS idx_candidates_archived ON candidates(is_archived);
  `);

  // 4. Dropdown options table
  db.exec(`
    CREATE TABLE IF NOT EXISTS dropdown_options (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      list_key TEXT NOT NULL,
      value TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0,
      UNIQUE(list_key, value)
    );
  `);

  // 5. Sub_Source -> Source mapping table
  db.exec(`
    CREATE TABLE IF NOT EXISTS sub_source_mappings (
      sub_source TEXT PRIMARY KEY,
      source TEXT NOT NULL
    );
  `);

  // 6. Hierarchy mappings (Region -> Location, Location -> Site)
  db.exec(`
    CREATE TABLE IF NOT EXISTS hierarchy_mappings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      parent_type TEXT NOT NULL CHECK(parent_type IN ('region', 'location')),
      parent_value TEXT NOT NULL,
      child_value TEXT NOT NULL,
      UNIQUE(parent_type, parent_value, child_value)
    );
  `);

  // 7. PIC Propose New Dropdown Value Requests
  db.exec(`
    CREATE TABLE IF NOT EXISTS dropdown_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      list_key TEXT NOT NULL,
      proposed_value TEXT NOT NULL,
      parent_value TEXT NOT NULL DEFAULT '',
      mapped_source TEXT NOT NULL DEFAULT '',
      reason TEXT NOT NULL DEFAULT '',
      requested_by TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected')),
      reviewed_by TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      reviewed_at TEXT NOT NULL DEFAULT ''
    );
  `);

  // 8. Append-only Audit Log table
  db.exec(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      actor_username TEXT NOT NULL,
      actor_role TEXT NOT NULL,
      action TEXT NOT NULL,
      candidate_code TEXT NOT NULL DEFAULT '',
      field_key TEXT NOT NULL DEFAULT '',
      old_value TEXT NOT NULL DEFAULT '',
      new_value TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_audit_candidate ON audit_logs(candidate_code);
    CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at DESC);
  `);

  seedDropdownsIfNeeded();
  seedInitialUsersIfNeeded();
}

function seedDropdownsIfNeeded(): void {
  const countRow = db.prepare('SELECT COUNT(*) as cnt FROM dropdown_options').get() as { cnt: number };
  if (countRow.cnt > 0) return;

  const insertOption = db.prepare(
    'INSERT OR IGNORE INTO dropdown_options (list_key, value, active, sort_order) VALUES (?, ?, 1, ?)'
  );
  const insertSubMap = db.prepare(
    'INSERT OR REPLACE INTO sub_source_mappings (sub_source, source) VALUES (?, ?)'
  );
  const insertHierarchy = db.prepare(
    'INSERT OR IGNORE INTO hierarchy_mappings (parent_type, parent_value, child_value) VALUES (?, ?, ?)'
  );

  const tx = db.transaction(() => {
    for (const list of INITIAL_DROPDOWN_LISTS) {
      list.options.forEach((opt, idx) => {
        insertOption.run(list.listKey, opt, idx + 1);
      });
    }

    for (const [subSource, source] of Object.entries(INITIAL_SUB_SOURCE_MAPPING)) {
      insertSubMap.run(subSource, source);
    }

    for (const [region, locations] of Object.entries(INITIAL_REGION_TO_LOCATIONS)) {
      for (const loc of locations) {
        insertHierarchy.run('region', region, loc);
      }
    }

    for (const [location, sites] of Object.entries(INITIAL_LOCATION_TO_SITES)) {
      for (const site of sites) {
        insertHierarchy.run('location', location, site);
      }
    }
  });

  tx();
}

function seedInitialUsersIfNeeded(): void {
  const adminUser = (process.env.INITIAL_ADMIN_USERNAME || '').trim();
  const adminPass = process.env.INITIAL_ADMIN_PASSWORD || '';

  const countRow = db.prepare('SELECT COUNT(*) as cnt FROM users').get() as { cnt: number };
  if (countRow.cnt > 0) {
    // If only the initial admin exists and has not changed password yet, sync with env vars if provided
    if (countRow.cnt === 1 && adminUser && adminPass.length >= 8) {
      const existingAdmin = db
        .prepare("SELECT id, must_change_password FROM users WHERE role = 'admin' LIMIT 1")
        .get() as { id: number; must_change_password: number } | undefined;
      if (existingAdmin && existingAdmin.must_change_password === 1) {
        const hash = bcrypt.hashSync(adminPass, 10);
        db.prepare('UPDATE users SET username = ?, password_hash = ? WHERE id = ?').run(
          adminUser,
          hash,
          existingAdmin.id
        );
      }
    }
    return;
  }

  if (!adminUser || !adminPass) {
    console.warn(
      '[TA TRACKER] Chưa cấu hình INITIAL_ADMIN_USERNAME và INITIAL_ADMIN_PASSWORD trong biến môi trường (.env). Vui lòng thiết lập để khởi tạo tài khoản Admin đầu tiên.'
    );
    return;
  }

  if (adminPass.length < 8) {
    console.warn(
      '[TA TRACKER] INITIAL_ADMIN_PASSWORD phải có ít nhất 8 ký tự.'
    );
    return;
  }

  const hash = bcrypt.hashSync(adminPass, 10);
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO users (username, password_hash, role, pic_code, full_name, must_change_password, active, created_at)
     VALUES (?, ?, 'admin', '', 'Quản trị viên Hệ thống', 1, 1, ?)`
  ).run(adminUser, hash, now);

  console.log(
    `[TA TRACKER] First-run setup: Created initial admin account "${adminUser}" from environment variables (password change required on first login).`
  );
}

export function getDropdownConfigBundle(): DropdownConfigBundle {
  const optionRows = db
    .prepare('SELECT list_key, value, active FROM dropdown_options ORDER BY sort_order ASC, id ASC')
    .all() as { list_key: string; value: string; active: number }[];

  const lists: Record<string, { value: string; active: boolean }[]> = {};
  for (const row of optionRows) {
    if (!lists[row.list_key]) lists[row.list_key] = [];
    lists[row.list_key].push({ value: row.value, active: row.active === 1 });
  }

  const subRows = db
    .prepare('SELECT sub_source, source FROM sub_source_mappings')
    .all() as { sub_source: string; source: string }[];
  const subSourceMapping: Record<string, string> = {};
  for (const r of subRows) {
    subSourceMapping[r.sub_source] = r.source;
  }

  const hierRows = db
    .prepare('SELECT parent_type, parent_value, child_value FROM hierarchy_mappings ORDER BY id ASC')
    .all() as { parent_type: 'region' | 'location'; parent_value: string; child_value: string }[];

  const regionToLocations: Record<string, string[]> = {};
  const locationToSites: Record<string, string[]> = {};

  for (const h of hierRows) {
    if (h.parent_type === 'region') {
      if (!regionToLocations[h.parent_value]) regionToLocations[h.parent_value] = [];
      regionToLocations[h.parent_value].push(h.child_value);
    } else if (h.parent_type === 'location') {
      if (!locationToSites[h.parent_value]) locationToSites[h.parent_value] = [];
      locationToSites[h.parent_value].push(h.child_value);
    }
  }

  return {
    lists,
    subSourceMapping,
    regionToLocations,
    locationToSites,
  };
}

export function appendAuditLog(params: {
  actorUsername: string;
  actorRole: string;
  action: string;
  candidateCode?: string;
  fieldKey?: string;
  oldValue?: string;
  newValue?: string;
}): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO audit_logs (actor_username, actor_role, action, candidate_code, field_key, old_value, new_value, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    params.actorUsername,
    params.actorRole,
    params.action,
    params.candidateCode || '',
    params.fieldKey || '',
    params.oldValue ?? '',
    params.newValue ?? '',
    now
  );
}
