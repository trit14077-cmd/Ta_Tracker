import express, { Request, Response, NextFunction } from 'express';
import cookieParser from 'cookie-parser';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import multer from 'multer';
import * as XLSX from 'xlsx';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { createServer as createViteServer } from 'vite';
import {
  db,
  initDatabase,
  getDropdownConfigBundle,
  appendAuditLog,
} from './src/server/db.ts';
import {
  FIELD_CATALOG,
  FIELD_BY_KEY,
} from './src/shared/fieldCatalog.ts';
import {
  INITIAL_DROPDOWN_LISTS,
} from './src/shared/seedData.ts';
import {
  validateAndComputeCandidate,
  normalizeAndValidatePhone,
  formatIsoDateToDisplay,
  computeObMonth,
  computeTenor,
  computeSourceFromSubSource,
  applyLegacyImportTransformations,
  sanitizeCellForSpreadsheet,
  getTodayIsoInHoChiMinh,
} from './src/shared/validation.ts';

initDatabase();

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '15mb' }));
app.use(cookieParser());

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
});

const SESSION_COOKIE_NAME = 'ta_tracker_sid';
const SESSION_TTL_MS = 1000 * 60 * 60 * 12; // 12 hours

export interface AuthUser {
  id: number;
  username: string;
  role: 'admin' | 'pic';
  pic_code: string;
  full_name: string;
  must_change_password: boolean;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

// Simple in-memory rate limiter for login attempts (per IP + username)
const loginAttempts = new Map<string, { count: number; resetAt: number }>();
const MAX_LOGIN_ATTEMPTS = 8;
const LOGIN_WINDOW_MS = 10 * 60 * 1000; // 10 minutes

function checkRateLimit(key: string): { allowed: boolean; retryAfterSec?: number } {
  const now = Date.now();
  const entry = loginAttempts.get(key);
  if (!entry || now > entry.resetAt) {
    loginAttempts.set(key, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
    return { allowed: true };
  }
  if (entry.count >= MAX_LOGIN_ATTEMPTS) {
    return {
      allowed: false,
      retryAfterSec: Math.ceil((entry.resetAt - now) / 1000),
    };
  }
  entry.count += 1;
  return { allowed: true };
}

function clearRateLimit(key: string): void {
  loginAttempts.delete(key);
}

// Format current timestamp in Asia/Ho_Chi_Minh as DD/MM/YYYY HH:mm:ss
function formatNowTimestampHoChiMinh(): string {
  const dtf = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  return dtf.format(new Date()).replace(',', '');
}

// Hydrate candidate row from DB: recalculate dynamic `tenor` and `ob_month` & format dates for display
function hydrateCandidateRow(row: Record<string, unknown>, todayIso: string): Record<string, unknown> {
  const out: Record<string, unknown> = {
    id: row.id,
    row_version: row.row_version,
    is_archived: Boolean(row.is_archived),
    updated_at: row.updated_at,
  };

  const obIso = String(row.ob_date ?? '');
  const empStt = String(row.emp_status ?? '');
  const attrIso = String(row.attrition_date ?? '');

  for (const field of FIELD_CATALOG) {
    const raw = String(row[field.key] ?? '');
    if (field.type === 'date') {
      out[field.key] = formatIsoDateToDisplay(raw);
      out[`${field.key}_iso`] = raw;
    } else if (field.key === 'ob_month') {
      out.ob_month = computeObMonth(obIso);
    } else if (field.key === 'tenor') {
      out.tenor = computeTenor(obIso, empStt, attrIso, todayIso);
    } else {
      out[field.key] = raw;
    }
  }
  return out;
}

// Auth middleware (reads HttpOnly cookie first; falls back to x-session-token header if third-party cookies are blocked in preview iframe)
function extractSessionToken(req: Request): string {
  const cookieToken = req.cookies?.[SESSION_COOKIE_NAME];
  if (cookieToken && typeof cookieToken === 'string') return cookieToken;
  const headerToken = req.headers['x-session-token'];
  if (typeof headerToken === 'string' && headerToken.trim()) return headerToken.trim();
  return '';
}

function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const token = extractSessionToken(req);
  if (!token) {
    res.status(401).json({
      success: false,
      error: { code: 'UNAUTHORIZED', message: 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.' },
    });
    return;
  }

  const now = Date.now();
  const row = db
    .prepare(
      `SELECT s.token, s.expires_at, u.id, u.username, u.role, u.pic_code, u.full_name, u.must_change_password, u.active
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token = ?`
    )
    .get(token) as
    | {
        token: string;
        expires_at: number;
        id: number;
        username: string;
        role: 'admin' | 'pic';
        pic_code: string;
        full_name: string;
        must_change_password: number;
        active: number;
      }
    | undefined;

  if (!row || row.expires_at < now || row.active !== 1) {
    if (row) {
      db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    }
    res.clearCookie(SESSION_COOKIE_NAME);
    res.status(401).json({
      success: false,
      error: { code: 'UNAUTHORIZED', message: 'Phiên đăng nhập không hợp lệ hoặc tài khoản đã bị khóa.' },
    });
    return;
  }

  req.user = {
    id: row.id,
    username: row.username,
    role: row.role,
    pic_code: row.pic_code,
    full_name: row.full_name,
    must_change_password: row.must_change_password === 1,
  };
  next();
}

function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!req.user || req.user.role !== 'admin') {
    res.status(403).json({
      success: false,
      error: { code: 'FORBIDDEN', message: 'Chỉ Quản trị viên (Admin) mới có quyền thực hiện thao tác này.' },
    });
    return;
  }
  next();
}

// ============================================================================
// AUTH ENDPOINTS
// ============================================================================

app.post('/api/auth/login', (req: Request, res: Response) => {
  const username = String(req.body?.username ?? '').trim();
  const password = String(req.body?.password ?? '');
  const ip = req.ip || 'local';
  const rateKey = `${ip}:${username.toLowerCase()}`;

  const rate = checkRateLimit(rateKey);
  if (!rate.allowed) {
    res.status(429).json({
      success: false,
      error: {
        code: 'RATE_LIMITED',
        message: `Đăng nhập sai quá nhiều lần. Vui lòng thử lại sau ${rate.retryAfterSec} giây.`,
      },
    });
    return;
  }

  if (!username || !password) {
    res.status(400).json({
      success: false,
      error: { code: 'INVALID_INPUT', message: 'Vui lòng nhập tên đăng nhập và mật khẩu.' },
    });
    return;
  }

  const userRow = db
    .prepare(
      'SELECT id, username, password_hash, role, pic_code, full_name, must_change_password, active FROM users WHERE username = ?'
    )
    .get(username) as
    | {
        id: number;
        username: string;
        password_hash: string;
        role: 'admin' | 'pic';
        pic_code: string;
        full_name: string;
        must_change_password: number;
        active: number;
      }
    | undefined;

  if (!userRow || !bcrypt.compareSync(password, userRow.password_hash)) {
    res.status(401).json({
      success: false,
      error: { code: 'INVALID_CREDENTIALS', message: 'Tên đăng nhập hoặc mật khẩu không chính xác.' },
    });
    return;
  }

  if (userRow.active !== 1) {
    res.status(403).json({
      success: false,
      error: { code: 'ACCOUNT_DISABLED', message: 'Tài khoản này đã bị vô hiệu hóa. Vui lòng liên hệ Admin.' },
    });
    return;
  }

  clearRateLimit(rateKey);

  const token = crypto.randomBytes(32).toString('hex');
  const now = Date.now();
  const expiresAt = now + SESSION_TTL_MS;

  db.prepare('INSERT INTO sessions (token, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)').run(
    token,
    userRow.id,
    expiresAt,
    new Date(now).toISOString()
  );

  const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https';

  // On HTTPS (such as cross-origin preview iframe), use SameSite=None; Secure; Partitioned.
  // On HTTP (internal Windows LAN), use SameSite=Lax.
  res.cookie(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: isHttps ? 'none' : 'lax',
    secure: isHttps,
    partitioned: isHttps,
    maxAge: SESSION_TTL_MS,
    path: '/',
  });

  res.json({
    success: true,
    sessionToken: token,
    user: {
      id: userRow.id,
      username: userRow.username,
      role: userRow.role,
      pic_code: userRow.pic_code,
      full_name: userRow.full_name,
      must_change_password: userRow.must_change_password === 1,
    },
  });
});

app.post('/api/auth/logout', (req: Request, res: Response) => {
  const token = extractSessionToken(req);
  if (token) {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  }
  const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https';
  res.clearCookie(SESSION_COOKIE_NAME, {
    path: '/',
    sameSite: isHttps ? 'none' : 'lax',
    secure: isHttps,
  });
  res.json({ success: true });
});

app.get('/api/me', requireAuth, (req: Request, res: Response) => {
  const cookiePresent = Boolean(req.cookies?.[SESSION_COOKIE_NAME]);
  res.json({ success: true, user: req.user, cookiePresent });
});

app.post('/api/auth/change-password', requireAuth, (req: Request, res: Response) => {
  const currentPassword = String(req.body?.currentPassword ?? '');
  const newPassword = String(req.body?.newPassword ?? '');

  if (!newPassword || newPassword.length < 8) {
    res.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_FAILED',
        message: 'Mật khẩu mới phải có ít nhất 8 ký tự.',
      },
    });
    return;
  }

  const userRow = db
    .prepare('SELECT id, password_hash FROM users WHERE id = ?')
    .get(req.user!.id) as { id: number; password_hash: string } | undefined;

  if (!userRow || !bcrypt.compareSync(currentPassword, userRow.password_hash)) {
    res.status(400).json({
      success: false,
      error: {
        code: 'INVALID_PASSWORD',
        message: 'Mật khẩu hiện tại không đúng.',
      },
    });
    return;
  }

  const newHash = bcrypt.hashSync(newPassword, 10);
  db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?').run(
    newHash,
    req.user!.id
  );

  appendAuditLog({
    actorUsername: req.user!.username,
    actorRole: req.user!.role,
    action: 'USER',
    fieldKey: 'password',
    oldValue: '***',
    newValue: 'Đã đổi mật khẩu cá nhân',
  });

  res.json({ success: true });
});

// ============================================================================
// PHONE DUPLICATE CHECK (WARN ONLY, DO NOT BLOCK)
// ============================================================================

function handleCheckPhone(req: Request, res: Response): void {
  const rawPhone = String(req.query.phone ?? '');
  const excludeCode = String(req.query.excludeCode ?? '').trim();
  const norm = normalizeAndValidatePhone(rawPhone);

  if (!norm.normalized || norm.error) {
    res.json({
      success: true,
      normalized: norm.normalized,
      wasNormalized: norm.wasNormalized,
      notice: norm.notice,
      duplicates: [],
    });
    return;
  }

  const rows = excludeCode
    ? (db
        .prepare(
          'SELECT id, candidate_code, full_name, pic, position, created_at FROM candidates WHERE phone = ? AND candidate_code != ? LIMIT 10'
        )
        .all(norm.normalized, excludeCode) as Record<string, unknown>[])
    : (db
        .prepare(
          'SELECT id, candidate_code, full_name, pic, position, created_at FROM candidates WHERE phone = ? LIMIT 10'
        )
        .all(norm.normalized) as Record<string, unknown>[]);

  res.json({
    success: true,
    normalized: norm.normalized,
    wasNormalized: norm.wasNormalized,
    notice: norm.notice,
    duplicates: rows,
  });
}

app.get('/api/candidates/check-phone', requireAuth, handleCheckPhone);
app.get('/api/check-phone', requireAuth, handleCheckPhone);

// ============================================================================
// CANDIDATES LIST, DETAIL, CREATE, PATCH (OPTIMISTIC LOCK), ARCHIVE
// ============================================================================

interface CandidateFilterQuery {
  whereSql: string;
  params: unknown[];
  tenorFilter: string;
}

function buildCandidateFilterQuery(query: Record<string, unknown>): CandidateFilterQuery {
  const clauses: string[] = [];
  const params: unknown[] = [];

  const includeArchived = String(query.archived ?? '0') === '1';
  if (!includeArchived) {
    clauses.push('is_archived = 0');
  }

  const search = String(query.search ?? '').trim();
  if (search) {
    // Normalize phone search if numeric
    const phoneAttempt = search.replace(/[\s.\-()]/g, '').replace(/^(\+84|0)/, '');
    clauses.push('(candidate_code LIKE ? OR full_name LIKE ? OR phone LIKE ? OR phone LIKE ?)');
    params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${phoneAttempt}%`);
  }

  const exactFilters = [
    'pic',
    'position',
    'site',
    'source',
    'r1_stt',
    'r2_stt',
    'ob_status',
    'emp_status',
    'ob_month',
    'region',
    'location',
  ];

  for (const fKey of exactFilters) {
    const val = String(query[fKey] ?? '').trim();
    if (val) {
      clauses.push(`${fKey} = ?`);
      params.push(val);
    }
  }

  const dateFrom = String(query.date_from ?? '').trim();
  if (dateFrom && /^\d{4}-\d{2}-\d{2}$/.test(dateFrom)) {
    clauses.push('(ob_date >= ? OR r1_date >= ?)');
    params.push(dateFrom, dateFrom);
  }

  const dateTo = String(query.date_to ?? '').trim();
  if (dateTo && /^\d{4}-\d{2}-\d{2}$/.test(dateTo)) {
    clauses.push('(ob_date <= ? OR r1_date <= ?)');
    params.push(dateTo, dateTo);
  }

  const tenorFilter = String(query.tenor ?? '').trim();
  const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';

  return { whereSql, params, tenorFilter };
}

const ALLOWED_SORT_COLUMNS = new Set([
  'id',
  'created_at',
  'candidate_code',
  'full_name',
  'position',
  'site',
  'pic',
  'source',
  'r1_date',
  'r1_stt',
  'r2_date',
  'r2_stt',
  'ob_date',
  'ob_month',
  'ob_status',
  'gross_salary',
  'emp_status',
  'attrition_date',
]);

app.get('/api/candidates', requireAuth, (req: Request, res: Response) => {
  const page = Math.max(1, parseInt(String(req.query.page ?? '1'), 10) || 1);
  const pageSize = Math.min(200, Math.max(10, parseInt(String(req.query.pageSize ?? '25'), 10) || 25));
  const sortByRaw = String(req.query.sortBy ?? 'id');
  const sortBy = ALLOWED_SORT_COLUMNS.has(sortByRaw) ? sortByRaw : 'id';
  const sortDir = String(req.query.sortDir ?? 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC';

  const { whereSql, params, tenorFilter } = buildCandidateFilterQuery(req.query as Record<string, unknown>);
  const todayIso = getTodayIsoInHoChiMinh();

  // If tenorFilter is active, since tenor depends on live today in Asia/Ho_Chi_Minh,
  // we hydrate and filter accurately
  if (tenorFilter) {
    const allRows = db
      .prepare(`SELECT * FROM candidates ${whereSql} ORDER BY ${sortBy} ${sortDir}, id DESC`)
      .all(...params) as Record<string, unknown>[];
    const hydrated = allRows
      .map((r) => hydrateCandidateRow(r, todayIso))
      .filter((r) => r.tenor === tenorFilter);

    const total = hydrated.length;
    const paged = hydrated.slice((page - 1) * pageSize, page * pageSize);
    res.json({
      success: true,
      items: paged,
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    });
    return;
  }

  const countRow = db
    .prepare(`SELECT COUNT(*) as cnt FROM candidates ${whereSql}`)
    .get(...params) as { cnt: number };
  const total = countRow.cnt;

  const offset = (page - 1) * pageSize;
  const rows = db
    .prepare(`SELECT * FROM candidates ${whereSql} ORDER BY ${sortBy} ${sortDir}, id DESC LIMIT ? OFFSET ?`)
    .all(...params, pageSize, offset) as Record<string, unknown>[];

  const items = rows.map((r) => hydrateCandidateRow(r, todayIso));

  res.json({
    success: true,
    items,
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  });
});

app.get('/api/candidates/:id', requireAuth, (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const row = db.prepare('SELECT * FROM candidates WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  if (!row) {
    res.status(404).json({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Không tìm thấy hồ sơ ứng viên.' },
    });
    return;
  }
  res.json({
    success: true,
    candidate: hydrateCandidateRow(row, getTodayIsoInHoChiMinh()),
  });
});

app.post('/api/candidates', requireAuth, (req: Request, res: Response) => {
  const user = req.user!;
  const config = getDropdownConfigBundle();
  const payload = { ...(req.body || {}) };

  // A PIC user creating a candidate must have their own PIC assigned (or if pic is empty, default to their pic_code)
  if (user.role === 'pic') {
    if (!user.pic_code) {
      res.status(403).json({
        success: false,
        error: {
          code: 'NO_PIC_ASSIGNED',
          message: 'Tài khoản PIC của bạn chưa được gán mã PIC trong hệ thống. Vui lòng liên hệ Admin.',
        },
      });
      return;
    }
    if (payload.pic && payload.pic !== user.pic_code) {
      res.status(403).json({
        success: false,
        error: {
          code: 'FORBIDDEN_PIC',
          message: `Tài khoản PIC chỉ được tạo ứng viên thuộc mã PIC của mình (${user.pic_code}).`,
        },
      });
      return;
    }
    payload.pic = user.pic_code;
  }

  const validation = validateAndComputeCandidate(payload, config);

  // Check uniqueness of candidate_code
  if (validation.sanitized.candidate_code) {
    const existingCode = db
      .prepare('SELECT id FROM candidates WHERE candidate_code = ?')
      .get(validation.sanitized.candidate_code) as { id: number } | undefined;
    if (existingCode) {
      validation.errors.candidate_code = `Mã ứng viên "${validation.sanitized.candidate_code}" đã tồn tại trên hệ thống. Cách sửa: Nhập mã ứng viên khác chưa trùng.`;
      validation.valid = false;
    }
  }

  if (!validation.valid) {
    res.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_FAILED',
        fields: validation.errors,
      },
    });
    return;
  }

  const createdAt = formatNowTimestampHoChiMinh();
  const nowIso = new Date().toISOString();
  validation.sanitized.created_at = createdAt;

  // Check duplicate phone warning (do not block)
  const phoneDuplicates = db
    .prepare('SELECT candidate_code, full_name, pic FROM candidates WHERE phone = ? LIMIT 5')
    .all(validation.sanitized.phone) as { candidate_code: string; full_name: string; pic: string }[];

  const columns = ['row_version', 'is_archived', 'updated_at', ...FIELD_CATALOG.map((f) => f.key)];
  const placeholders = columns.map(() => '?').join(', ');
  const values = [
    1,
    0,
    nowIso,
    ...FIELD_CATALOG.map((f) => validation.sanitized[f.key] ?? ''),
  ];

  const tx = db.transaction(() => {
    const result = db
      .prepare(`INSERT INTO candidates (${columns.join(', ')}) VALUES (${placeholders})`)
      .run(...values);

    appendAuditLog({
      actorUsername: user.username,
      actorRole: user.role,
      action: 'CREATE',
      candidateCode: validation.sanitized.candidate_code,
      fieldKey: 'ALL',
      oldValue: '',
      newValue: `Tạo mới hồ sơ ứng viên (${validation.sanitized.full_name} - PIC: ${validation.sanitized.pic})`,
    });

    return Number(result.lastInsertRowid);
  });

  const newId = tx();
  const createdRow = db.prepare('SELECT * FROM candidates WHERE id = ?').get(newId) as Record<string, unknown>;

  res.status(201).json({
    success: true,
    candidate: hydrateCandidateRow(createdRow, getTodayIsoInHoChiMinh()),
    notices: validation.notices,
    phoneDuplicates,
  });
});

app.patch('/api/candidates/:id', requireAuth, (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const user = req.user!;
  const existingRow = db.prepare('SELECT * FROM candidates WHERE id = ?').get(id) as Record<string, unknown> | undefined;

  if (!existingRow) {
    res.status(404).json({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Không tìm thấy hồ sơ ứng viên.' },
    });
    return;
  }

  // Permission check: A pic user can edit/archive only rows whose `pic` equals their own PIC value; admin can edit all.
  if (user.role !== 'admin') {
    if (!user.pic_code || String(existingRow.pic) !== user.pic_code) {
      res.status(403).json({
        success: false,
        error: {
          code: 'FORBIDDEN',
          message: `Bạn chỉ có quyền chỉnh sửa ứng viên do chính mình phụ trách (PIC: ${user.pic_code || 'Chưa gán'}). Hồ sơ này thuộc PIC "${existingRow.pic}".`,
        },
      });
      return;
    }
  }

  // Optimistic locking check: require row_version
  const clientVersion = Number(req.body?.row_version);
  if (!clientVersion || clientVersion !== Number(existingRow.row_version)) {
    res.status(409).json({
      success: false,
      error: {
        code: 'ROW_CONFLICT',
        message:
          'Hồ sơ ứng viên này vừa được người dùng khác cập nhật. Vui lòng đối chiếu phiên bản hiện tại trên máy chủ trước khi ghi đè.',
        currentRow: hydrateCandidateRow(existingRow, getTodayIsoInHoChiMinh()),
      },
    });
    return;
  }

  const incomingChanges = { ...(req.body || {}) };
  delete incomingChanges.row_version;
  delete incomingChanges.id;
  delete incomingChanges.is_archived;
  delete incomingChanges.updated_at;

  // Prevent non-admin PIC from reassigning the row to another PIC
  if (user.role !== 'admin' && incomingChanges.pic && incomingChanges.pic !== user.pic_code) {
    res.status(403).json({
      success: false,
      error: {
        code: 'FORBIDDEN_PIC_CHANGE',
        message: 'Tài khoản PIC không được chuyển hồ sơ sang mã PIC của người khác.',
      },
    });
    return;
  }

  const config = getDropdownConfigBundle();
  const validation = validateAndComputeCandidate(incomingChanges, config, {
    existingValues: existingRow,
    isPartialPatch: true,
  });

  // Check candidate_code uniqueness if changed
  if (
    validation.sanitized.candidate_code &&
    validation.sanitized.candidate_code !== String(existingRow.candidate_code)
  ) {
    const dupCode = db
      .prepare('SELECT id FROM candidates WHERE candidate_code = ? AND id != ?')
      .get(validation.sanitized.candidate_code, id) as { id: number } | undefined;
    if (dupCode) {
      validation.errors.candidate_code = `Mã ứng viên "${validation.sanitized.candidate_code}" đã tồn tại ở hồ sơ khác. Cách sửa: Nhập mã ứng viên duy nhất.`;
      validation.valid = false;
    }
  }

  if (!validation.valid) {
    res.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_FAILED',
        fields: validation.errors,
      },
    });
    return;
  }

  // Preserve original created_at
  validation.sanitized.created_at = String(existingRow.created_at);

  const nextVersion = Number(existingRow.row_version) + 1;
  const nowIso = new Date().toISOString();

  const updateFields = FIELD_CATALOG.map((f) => f.key);
  const setClause = [
    'row_version = ?',
    'updated_at = ?',
    ...updateFields.map((k) => `${k} = ?`),
  ].join(', ');

  const values = [
    nextVersion,
    nowIso,
    ...updateFields.map((k) => validation.sanitized[k] ?? ''),
    id,
    clientVersion,
  ];

  const tx = db.transaction(() => {
    const resUpdate = db
      .prepare(`UPDATE candidates SET ${setClause} WHERE id = ? AND row_version = ?`)
      .run(...values);

    if (resUpdate.changes === 0) {
      return false;
    }

    // Record field-level audit logs for every changed field
    for (const field of FIELD_CATALOG) {
      const oldVal = String(existingRow[field.key] ?? '');
      const newVal = String(validation.sanitized[field.key] ?? '');
      if (oldVal !== newVal) {
        appendAuditLog({
          actorUsername: user.username,
          actorRole: user.role,
          action: 'UPDATE',
          candidateCode: validation.sanitized.candidate_code,
          fieldKey: field.key,
          oldValue: field.type === 'date' ? formatIsoDateToDisplay(oldVal) : oldVal,
          newValue: field.type === 'date' ? formatIsoDateToDisplay(newVal) : newVal,
        });
      }
    }
    return true;
  });

  const ok = tx();
  if (!ok) {
    const latestRow = db.prepare('SELECT * FROM candidates WHERE id = ?').get(id) as Record<string, unknown>;
    res.status(409).json({
      success: false,
      error: {
        code: 'ROW_CONFLICT',
        message: 'Phát hiện xung đột phiên bản khi đang lưu.',
        currentRow: hydrateCandidateRow(latestRow, getTodayIsoInHoChiMinh()),
      },
    });
    return;
  }

  const updatedRow = db.prepare('SELECT * FROM candidates WHERE id = ?').get(id) as Record<string, unknown>;
  const phoneDuplicates = db
    .prepare('SELECT candidate_code, full_name, pic FROM candidates WHERE phone = ? AND id != ? LIMIT 5')
    .all(validation.sanitized.phone, id) as { candidate_code: string; full_name: string; pic: string }[];

  res.json({
    success: true,
    candidate: hydrateCandidateRow(updatedRow, getTodayIsoInHoChiMinh()),
    notices: validation.notices,
    phoneDuplicates,
  });
});

app.post('/api/candidates/:id/archive', requireAuth, (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const user = req.user!;
  const existingRow = db.prepare('SELECT * FROM candidates WHERE id = ?').get(id) as Record<string, unknown> | undefined;

  if (!existingRow) {
    res.status(404).json({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Không tìm thấy hồ sơ ứng viên.' },
    });
    return;
  }

  if (user.role !== 'admin') {
    if (!user.pic_code || String(existingRow.pic) !== user.pic_code) {
      res.status(403).json({
        success: false,
        error: {
          code: 'FORBIDDEN',
          message: `Bạn chỉ có thể lưu trữ ứng viên do chính mình phụ trách (${user.pic_code || 'Chưa gán'}).`,
        },
      });
      return;
    }
  }

  const targetArchive = req.body?.archived !== undefined ? (req.body.archived ? 1 : 0) : existingRow.is_archived ? 0 : 1;
  const nextVersion = Number(existingRow.row_version) + 1;
  const nowIso = new Date().toISOString();

  db.prepare('UPDATE candidates SET is_archived = ?, row_version = ?, updated_at = ? WHERE id = ?').run(
    targetArchive,
    nextVersion,
    nowIso,
    id
  );

  appendAuditLog({
    actorUsername: user.username,
    actorRole: user.role,
    action: 'ARCHIVE',
    candidateCode: String(existingRow.candidate_code),
    fieldKey: 'is_archived',
    oldValue: existingRow.is_archived ? 'Đã lưu trữ' : 'Đang hoạt động',
    newValue: targetArchive ? 'Đã lưu trữ' : 'Đang hoạt động',
  });

  const updatedRow = db.prepare('SELECT * FROM candidates WHERE id = ?').get(id) as Record<string, unknown>;
  res.json({
    success: true,
    candidate: hydrateCandidateRow(updatedRow, getTodayIsoInHoChiMinh()),
  });
});

// ============================================================================
// DROPDOWNS & DROPDOWN REQUESTS ENDPOINTS
// ============================================================================

app.get('/api/dropdowns', requireAuth, (_req: Request, res: Response) => {
  const bundle = getDropdownConfigBundle();
  const meta = INITIAL_DROPDOWN_LISTS.map((m) => ({
    listKey: m.listKey,
    label: m.label,
  }));
  res.json({
    success: true,
    ...bundle,
    listMeta: meta,
  });
});

// Admin: Add new dropdown option
app.post('/api/dropdowns/options', requireAuth, requireAdmin, (req: Request, res: Response) => {
  const listKey = String(req.body?.listKey ?? '').trim();
  const value = String(req.body?.value ?? '').trim();
  const mappedSource = String(req.body?.mappedSource ?? '').trim();
  const parentValue = String(req.body?.parentValue ?? '').trim();

  if (!listKey || !value) {
    res.status(400).json({
      success: false,
      error: { code: 'INVALID_INPUT', message: 'Vui lòng chọn danh mục và nhập giá trị mới.' },
    });
    return;
  }

  const maxSortRow = db
    .prepare('SELECT COALESCE(MAX(sort_order), 0) as maxSort FROM dropdown_options WHERE list_key = ?')
    .get(listKey) as { maxSort: number };

  const tx = db.transaction(() => {
    db.prepare(
      'INSERT INTO dropdown_options (list_key, value, active, sort_order) VALUES (?, ?, 1, ?) ON CONFLICT(list_key, value) DO UPDATE SET active = 1'
    ).run(listKey, value, maxSortRow.maxSort + 1);

    if (listKey === 'sub_source' && mappedSource) {
      db.prepare('INSERT OR REPLACE INTO sub_source_mappings (sub_source, source) VALUES (?, ?)').run(
        value,
        mappedSource
      );
    }

    if (listKey === 'location' && parentValue) {
      db.prepare(
        'INSERT OR IGNORE INTO hierarchy_mappings (parent_type, parent_value, child_value) VALUES (?, ?, ?)'
      ).run('region', parentValue, value);
    }

    if (listKey === 'site' && parentValue) {
      db.prepare(
        'INSERT OR IGNORE INTO hierarchy_mappings (parent_type, parent_value, child_value) VALUES (?, ?, ?)'
      ).run('location', parentValue, value);
    }

    appendAuditLog({
      actorUsername: req.user!.username,
      actorRole: req.user!.role,
      action: 'DROPDOWN',
      fieldKey: listKey,
      oldValue: '',
      newValue: `Thêm tùy chọn: "${value}"`,
    });
  });

  tx();
  res.json({ success: true, dropdowns: getDropdownConfigBundle() });
});

// Admin: Rename or toggle active status of a dropdown option (never hard-delete)
app.patch('/api/dropdowns/options', requireAuth, requireAdmin, (req: Request, res: Response) => {
  const listKey = String(req.body?.listKey ?? '').trim();
  const oldValue = String(req.body?.oldValue ?? '').trim();
  const newValue = req.body?.newValue !== undefined ? String(req.body.newValue).trim() : oldValue;
  const active = req.body?.active !== undefined ? Boolean(req.body.active) : undefined;

  if (!listKey || !oldValue || !newValue) {
    res.status(400).json({
      success: false,
      error: { code: 'INVALID_INPUT', message: 'Thiếu thông tin tùy chọn cần cập nhật.' },
    });
    return;
  }

  const tx = db.transaction(() => {
    if (oldValue !== newValue) {
      db.prepare('UPDATE dropdown_options SET value = ? WHERE list_key = ? AND value = ?').run(
        newValue,
        listKey,
        oldValue
      );

      // Update candidate fields that use this dropdown listKey
      const matchingFields = FIELD_CATALOG.filter((f) => f.dropdownListKey === listKey);
      for (const f of matchingFields) {
        db.prepare(`UPDATE candidates SET ${f.key} = ? WHERE ${f.key} = ?`).run(newValue, oldValue);
      }

      // Also update mappings if applicable
      if (listKey === 'sub_source') {
        db.prepare('UPDATE sub_source_mappings SET sub_source = ? WHERE sub_source = ?').run(newValue, oldValue);
      } else if (listKey === 'region') {
        db.prepare(
          "UPDATE hierarchy_mappings SET parent_value = ? WHERE parent_type = 'region' AND parent_value = ?"
        ).run(newValue, oldValue);
      } else if (listKey === 'location') {
        db.prepare(
          "UPDATE hierarchy_mappings SET child_value = ? WHERE parent_type = 'region' AND child_value = ?"
        ).run(newValue, oldValue);
        db.prepare(
          "UPDATE hierarchy_mappings SET parent_value = ? WHERE parent_type = 'location' AND parent_value = ?"
        ).run(newValue, oldValue);
      } else if (listKey === 'site') {
        db.prepare(
          "UPDATE hierarchy_mappings SET child_value = ? WHERE parent_type = 'location' AND child_value = ?"
        ).run(newValue, oldValue);
      }

      // If renaming a PIC option, also update users.pic_code
      if (listKey === 'pic') {
        db.prepare('UPDATE users SET pic_code = ? WHERE pic_code = ?').run(newValue, oldValue);
      }

      appendAuditLog({
        actorUsername: req.user!.username,
        actorRole: req.user!.role,
        action: 'DROPDOWN',
        fieldKey: listKey,
        oldValue,
        newValue: `Đổi tên thành "${newValue}"`,
      });
    }

    if (active !== undefined) {
      db.prepare('UPDATE dropdown_options SET active = ? WHERE list_key = ? AND value = ?').run(
        active ? 1 : 0,
        listKey,
        newValue
      );

      appendAuditLog({
        actorUsername: req.user!.username,
        actorRole: req.user!.role,
        action: 'DROPDOWN',
        fieldKey: listKey,
        oldValue: newValue,
        newValue: active ? 'Kích hoạt lại' : 'Ngừng sử dụng (Deactivated)',
      });
    }
  });

  tx();
  res.json({ success: true, dropdowns: getDropdownConfigBundle() });
});

// Admin: Update Sub_Source -> Source mapping
app.put('/api/dropdowns/sub-source-mapping', requireAuth, requireAdmin, (req: Request, res: Response) => {
  const mapping = req.body?.mapping as Record<string, string> | undefined;
  if (!mapping || typeof mapping !== 'object') {
    res.status(400).json({
      success: false,
      error: { code: 'INVALID_INPUT', message: 'Dữ liệu ánh xạ Sub_Source -> Source không hợp lệ.' },
    });
    return;
  }

  const tx = db.transaction(() => {
    const upsert = db.prepare('INSERT OR REPLACE INTO sub_source_mappings (sub_source, source) VALUES (?, ?)');
    const updateCandidates = db.prepare('UPDATE candidates SET source = ? WHERE sub_source = ?');
    for (const [sub, src] of Object.entries(mapping)) {
      const cleanSub = sub.trim();
      const cleanSrc = String(src ?? '').trim();
      if (cleanSub) {
        upsert.run(cleanSub, cleanSrc);
        updateCandidates.run(cleanSrc, cleanSub);
      }
    }

    appendAuditLog({
      actorUsername: req.user!.username,
      actorRole: req.user!.role,
      action: 'DROPDOWN',
      fieldKey: 'sub_source_mapping',
      oldValue: '',
      newValue: 'Cập nhật bảng ánh xạ Sub_Source → Source',
    });
  });

  tx();
  res.json({ success: true, dropdowns: getDropdownConfigBundle() });
});

// Admin: Update Region -> Location -> Site hierarchy
app.put('/api/dropdowns/hierarchy', requireAuth, requireAdmin, (req: Request, res: Response) => {
  const regionToLocations = req.body?.regionToLocations as Record<string, string[]> | undefined;
  const locationToSites = req.body?.locationToSites as Record<string, string[]> | undefined;

  const tx = db.transaction(() => {
    if (regionToLocations && typeof regionToLocations === 'object') {
      db.prepare("DELETE FROM hierarchy_mappings WHERE parent_type = 'region'").run();
      const ins = db.prepare(
        "INSERT OR IGNORE INTO hierarchy_mappings (parent_type, parent_value, child_value) VALUES ('region', ?, ?)"
      );
      for (const [reg, locs] of Object.entries(regionToLocations)) {
        if (Array.isArray(locs)) {
          for (const l of locs) {
            if (l.trim()) ins.run(reg.trim(), l.trim());
          }
        }
      }
    }

    if (locationToSites && typeof locationToSites === 'object') {
      db.prepare("DELETE FROM hierarchy_mappings WHERE parent_type = 'location'").run();
      const ins = db.prepare(
        "INSERT OR IGNORE INTO hierarchy_mappings (parent_type, parent_value, child_value) VALUES ('location', ?, ?)"
      );
      for (const [loc, sites] of Object.entries(locationToSites)) {
        if (Array.isArray(sites)) {
          for (const s of sites) {
            if (s.trim()) ins.run(loc.trim(), s.trim());
          }
        }
      }
    }

    appendAuditLog({
      actorUsername: req.user!.username,
      actorRole: req.user!.role,
      action: 'DROPDOWN',
      fieldKey: 'hierarchy',
      oldValue: '',
      newValue: 'Cập nhật phân cấp Vùng (Region) → Tỉnh/Thành (Location) → Điểm làm việc (Site)',
    });
  });

  tx();
  res.json({ success: true, dropdowns: getDropdownConfigBundle() });
});

// PIC & Admin: Dropdown value requests
app.get('/api/dropdown-requests', requireAuth, (_req: Request, res: Response) => {
  const rows = db
    .prepare('SELECT * FROM dropdown_requests ORDER BY id DESC LIMIT 200')
    .all();
  res.json({ success: true, requests: rows });
});

app.post('/api/dropdown-requests', requireAuth, (req: Request, res: Response) => {
  const listKey = String(req.body?.listKey ?? '').trim();
  const proposedValue = String(req.body?.proposedValue ?? '').trim();
  const parentValue = String(req.body?.parentValue ?? '').trim();
  const mappedSource = String(req.body?.mappedSource ?? '').trim();
  const reason = String(req.body?.reason ?? '').trim();

  if (!listKey || !proposedValue) {
    res.status(400).json({
      success: false,
      error: { code: 'INVALID_INPUT', message: 'Vui lòng chọn danh mục và nhập giá trị đề xuất.' },
    });
    return;
  }

  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO dropdown_requests (list_key, proposed_value, parent_value, mapped_source, reason, requested_by, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`
  ).run(listKey, proposedValue, parentValue, mappedSource, reason, req.user!.username, now);

  appendAuditLog({
    actorUsername: req.user!.username,
    actorRole: req.user!.role,
    action: 'DROPDOWN',
    fieldKey: listKey,
    oldValue: '',
    newValue: `Đề xuất thêm giá trị mới: "${proposedValue}"`,
  });

  res.status(201).json({ success: true });
});

app.patch('/api/dropdown-requests/:id', requireAuth, requireAdmin, (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const status = String(req.body?.status ?? '') as 'approved' | 'rejected';
  if (status !== 'approved' && status !== 'rejected') {
    res.status(400).json({
      success: false,
      error: { code: 'INVALID_INPUT', message: 'Trạng thái duyệt không hợp lệ.' },
    });
    return;
  }

  const reqRow = db.prepare('SELECT * FROM dropdown_requests WHERE id = ?').get(id) as
    | {
        id: number;
        list_key: string;
        proposed_value: string;
        parent_value: string;
        mapped_source: string;
        status: string;
      }
    | undefined;

  if (!reqRow) {
    res.status(404).json({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Không tìm thấy yêu cầu đề xuất.' },
    });
    return;
  }

  const now = new Date().toISOString();
  const tx = db.transaction(() => {
    db.prepare(
      'UPDATE dropdown_requests SET status = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ?'
    ).run(status, req.user!.username, now, id);

    if (status === 'approved') {
      const maxSortRow = db
        .prepare('SELECT COALESCE(MAX(sort_order), 0) as maxSort FROM dropdown_options WHERE list_key = ?')
        .get(reqRow.list_key) as { maxSort: number };

      db.prepare(
        'INSERT INTO dropdown_options (list_key, value, active, sort_order) VALUES (?, ?, 1, ?) ON CONFLICT(list_key, value) DO UPDATE SET active = 1'
      ).run(reqRow.list_key, reqRow.proposed_value, maxSortRow.maxSort + 1);

      if (reqRow.list_key === 'sub_source' && reqRow.mapped_source) {
        db.prepare('INSERT OR REPLACE INTO sub_source_mappings (sub_source, source) VALUES (?, ?)').run(
          reqRow.proposed_value,
          reqRow.mapped_source
        );
      }
      if (reqRow.list_key === 'location' && reqRow.parent_value) {
        db.prepare(
          "INSERT OR IGNORE INTO hierarchy_mappings (parent_type, parent_value, child_value) VALUES ('region', ?, ?)"
        ).run(reqRow.parent_value, reqRow.proposed_value);
      }
      if (reqRow.list_key === 'site' && reqRow.parent_value) {
        db.prepare(
          "INSERT OR IGNORE INTO hierarchy_mappings (parent_type, parent_value, child_value) VALUES ('location', ?, ?)"
        ).run(reqRow.parent_value, reqRow.proposed_value);
      }
    }

    appendAuditLog({
      actorUsername: req.user!.username,
      actorRole: req.user!.role,
      action: 'DROPDOWN',
      fieldKey: reqRow.list_key,
      oldValue: reqRow.proposed_value,
      newValue: status === 'approved' ? 'Đã phê duyệt đề xuất' : 'Đã từ chối đề xuất',
    });
  });

  tx();
  res.json({ success: true, dropdowns: getDropdownConfigBundle() });
});

// ============================================================================
// EXCEL / CSV IMPORT (PREVIEW & COMMIT) & EXPORT
// ============================================================================

function mapHeaderToFieldKey(rawHeader: string): string | null {
  const clean = String(rawHeader ?? '').trim().toLowerCase();
  if (!clean) return null;

  for (const field of FIELD_CATALOG) {
    if (
      field.key.toLowerCase() === clean ||
      field.excelHeader.toLowerCase() === clean ||
      field.label.toLowerCase() === clean
    ) {
      return field.key;
    }
    if (field.aliases) {
      for (const alias of field.aliases) {
        if (alias.toLowerCase() === clean) {
          return field.key;
        }
      }
    }
  }
  return null;
}

app.post(
  '/api/import/preview',
  requireAuth,
  requireAdmin,
  upload.single('file'),
  (req: Request, res: Response) => {
    if (!req.file) {
      res.status(400).json({
        success: false,
        error: { code: 'NO_FILE', message: 'Vui lòng chọn file .xlsx hoặc .csv để tải lên.' },
      });
      return;
    }

    let workbook: XLSX.WorkBook;
    try {
      workbook = XLSX.read(req.file.buffer, { type: 'buffer', cellDates: false });
    } catch {
      res.status(400).json({
        success: false,
        error: { code: 'PARSE_ERROR', message: 'Không thể đọc file Excel/CSV. Vui lòng kiểm tra định dạng file.' },
      });
      return;
    }

    const firstSheetName = workbook.SheetNames[0];
    if (!firstSheetName) {
      res.status(400).json({
        success: false,
        error: { code: 'EMPTY_WORKBOOK', message: 'File tải lên không có sheet dữ liệu nào.' },
      });
      return;
    }

    const sheet = workbook.Sheets[firstSheetName];
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      defval: '',
      raw: true,
    });

    if (matrix.length < 2) {
      res.status(400).json({
        success: false,
        error: { code: 'EMPTY_ROWS', message: 'File không có dòng dữ liệu ứng viên nào dưới dòng tiêu đề.' },
      });
      return;
    }

    const headerRow = (matrix[0] || []).map((h) => String(h ?? '').trim());
    const columnMapping: { colIndex: number; header: string; fieldKey: string | null }[] = headerRow.map(
      (h, idx) => ({
        colIndex: idx,
        header: h,
        fieldKey: mapHeaderToFieldKey(h),
      })
    );

    const config = getDropdownConfigBundle();
    const existingCodesSet = new Set(
      (db.prepare('SELECT candidate_code FROM candidates').all() as { candidate_code: string }[]).map(
        (r) => r.candidate_code
      )
    );
    const seenCodesInFile = new Set<string>();

    const previewRows: {
      rowNumber: number;
      valid: boolean;
      errors: Record<string, string>;
      notices: Record<string, string>;
      data: Record<string, string>;
    }[] = [];

    for (let rIdx = 1; rIdx < matrix.length; rIdx++) {
      const rawCells = matrix[rIdx] || [];
      // Skip completely blank rows
      if (rawCells.every((c) => String(c ?? '').trim() === '')) {
        continue;
      }

      const rawObj: Record<string, string> = {};
      for (const col of columnMapping) {
        if (!col.fieldKey) continue;
        const cellVal = rawCells[col.colIndex];
        const fieldDef = FIELD_BY_KEY[col.fieldKey];

        if (fieldDef?.type === 'date' && typeof cellVal === 'number' && cellVal > 10000) {
          // Convert Excel serial date number to DD/MM/YYYY
          const parsedDate = XLSX.SSF.parse_date_code(cellVal);
          if (parsedDate) {
            rawObj[col.fieldKey] = `${String(parsedDate.d).padStart(2, '0')}/${String(parsedDate.m).padStart(2, '0')}/${parsedDate.y}`;
            continue;
          }
        }
        rawObj[col.fieldKey] = cellVal === null || cellVal === undefined ? '' : String(cellVal).trim();
      }

      // Apply legacy rules:
      // 1) OB_Sub_STT containing Tuyển mới / Tuyển thay thế / Tái tuyển dụng -> move to hire_type
      // 2) Decimal day fraction interview time (0.375 -> 09:00)
      const transformed = applyLegacyImportTransformations(rawObj);

      const validation = validateAndComputeCandidate(transformed, config);
      const code = validation.sanitized.candidate_code;

      if (code) {
        if (existingCodesSet.has(code)) {
          validation.errors.candidate_code = `Mã ứng viên "${code}" đã tồn tại trong cơ sở dữ liệu (không ghi đè).`;
          validation.valid = false;
        } else if (seenCodesInFile.has(code)) {
          validation.errors.candidate_code = `Mã ứng viên "${code}" bị trùng lặp ngay trong file tải lên.`;
          validation.valid = false;
        } else {
          seenCodesInFile.add(code);
        }
      }

      previewRows.push({
        rowNumber: rIdx + 1,
        valid: validation.valid,
        errors: validation.errors,
        notices: validation.notices,
        data: validation.sanitized,
      });
    }

    const validCount = previewRows.filter((r) => r.valid).length;
    const invalidCount = previewRows.length - validCount;

    res.json({
      success: true,
      fileName: req.file.originalname,
      columnMapping,
      totalRows: previewRows.length,
      validCount,
      invalidCount,
      rows: previewRows,
    });
  }
);

app.post('/api/import/commit', requireAuth, requireAdmin, (req: Request, res: Response) => {
  const rowsInput = req.body?.rows as Record<string, unknown>[] | undefined;
  if (!Array.isArray(rowsInput) || rowsInput.length === 0) {
    res.status(400).json({
      success: false,
      error: { code: 'EMPTY_COMMIT', message: 'Không có dòng dữ liệu nào được chọn để nhập.' },
    });
    return;
  }

  const config = getDropdownConfigBundle();
  const existingCodesSet = new Set(
    (db.prepare('SELECT candidate_code FROM candidates').all() as { candidate_code: string }[]).map(
      (r) => r.candidate_code
    )
  );
  const seenCodes = new Set<string>();

  const validatedToInsert: Record<string, string>[] = [];
  const rowErrors: { index: number; candidate_code: string; errors: Record<string, string> }[] = [];

  rowsInput.forEach((rawRow, idx) => {
    const strRow: Record<string, string> = {};
    for (const [k, v] of Object.entries(rawRow || {})) {
      strRow[k] = v === null || v === undefined ? '' : String(v);
    }
    const transformed = applyLegacyImportTransformations(strRow);
    const val = validateAndComputeCandidate(transformed, config);
    const code = val.sanitized.candidate_code;

    if (code) {
      if (existingCodesSet.has(code) || seenCodes.has(code)) {
        val.errors.candidate_code = `Mã ứng viên "${code}" bị trùng lặp.`;
        val.valid = false;
      } else {
        seenCodes.add(code);
      }
    }

    if (val.valid) {
      validatedToInsert.push(val.sanitized);
    } else {
      rowErrors.push({ index: idx, candidate_code: code || `Dòng #${idx + 1}`, errors: val.errors });
    }
  });

  if (validatedToInsert.length === 0) {
    res.status(400).json({
      success: false,
      error: {
        code: 'NO_VALID_ROWS',
        message: 'Không có dòng hợp lệ nào để lưu vào hệ thống.',
        rowErrors,
      },
    });
    return;
  }

  const nowTs = formatNowTimestampHoChiMinh();
  const nowIso = new Date().toISOString();
  const columns = ['row_version', 'is_archived', 'updated_at', ...FIELD_CATALOG.map((f) => f.key)];
  const placeholders = columns.map(() => '?').join(', ');
  const insertStmt = db.prepare(`INSERT INTO candidates (${columns.join(', ')}) VALUES (${placeholders})`);

  const tx = db.transaction(() => {
    for (const item of validatedToInsert) {
      const createdAt = item.created_at || nowTs;
      const values = [
        1,
        0,
        nowIso,
        ...FIELD_CATALOG.map((f) => (f.key === 'created_at' ? createdAt : item[f.key] ?? '')),
      ];
      insertStmt.run(...values);

      appendAuditLog({
        actorUsername: req.user!.username,
        actorRole: req.user!.role,
        action: 'IMPORT',
        candidateCode: item.candidate_code,
        fieldKey: 'ALL',
        oldValue: '',
        newValue: `Nhập từ Excel (${item.full_name} - PIC: ${item.pic})`,
      });
    }
  });

  tx();

  res.json({
    success: true,
    importedCount: validatedToInsert.length,
    skippedCount: rowErrors.length,
  });
});

// Export all 61 columns in exact order of FIELD_CATALOG, neutralizing spreadsheet formula injection
app.get('/api/export.xlsx', requireAuth, (req: Request, res: Response) => {
  const { whereSql, params, tenorFilter } = buildCandidateFilterQuery(req.query as Record<string, unknown>);
  const todayIso = getTodayIsoInHoChiMinh();

  const rawRows = db
    .prepare(`SELECT * FROM candidates ${whereSql} ORDER BY id DESC`)
    .all(...params) as Record<string, unknown>[];

  const hydratedRows = rawRows
    .map((r) => hydrateCandidateRow(r, todayIso))
    .filter((r) => (!tenorFilter ? true : r.tenor === tenorFilter));

  const headers = FIELD_CATALOG.map((f) => f.excelHeader);
  const dataMatrix: string[][] = [headers];

  for (const row of hydratedRows) {
    const line = FIELD_CATALOG.map((f) => sanitizeCellForSpreadsheet(row[f.key]));
    dataMatrix.push(line);
  }

  const ws = XLSX.utils.aoa_to_sheet(dataMatrix);
  ws['!cols'] = FIELD_CATALOG.map((f) => ({ wch: Math.max(14, Math.round((f.width || 140) / 8)) }));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'TA_Tracker_Candidates');

  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="TA_TRACKER_UngVien_${todayIso}.xlsx"`
  );
  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  );
  res.send(buf);
});

app.get('/api/import/template.xlsx', requireAuth, (_req: Request, res: Response) => {
  const headers = FIELD_CATALOG.map((f) => f.excelHeader);
  const sampleDesc = FIELD_CATALOG.map((f) => `${f.label}${f.required ? ' (*)' : ''}`);
  const ws = XLSX.utils.aoa_to_sheet([headers, sampleDesc]);
  ws['!cols'] = FIELD_CATALOG.map((f) => ({ wch: 20 }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Template_61_Cot');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Disposition', 'attachment; filename="TA_TRACKER_Template_61_Cot.xlsx"');
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buf);
});

// ============================================================================
// AUDIT LOG ENDPOINT (VISIBLE TO EVERY LOGGED-IN USER)
// ============================================================================

app.get('/api/audit', requireAuth, (req: Request, res: Response) => {
  const page = Math.max(1, parseInt(String(req.query.page ?? '1'), 10) || 1);
  const pageSize = Math.min(200, Math.max(20, parseInt(String(req.query.pageSize ?? '50'), 10) || 50));
  const candidateCode = String(req.query.candidate_code ?? '').trim();
  const actor = String(req.query.actor ?? '').trim();
  const action = String(req.query.action ?? '').trim();

  const clauses: string[] = [];
  const params: unknown[] = [];

  if (candidateCode) {
    clauses.push('candidate_code LIKE ?');
    params.push(`%${candidateCode}%`);
  }
  if (actor) {
    clauses.push('actor_username LIKE ?');
    params.push(`%${actor}%`);
  }
  if (action) {
    clauses.push('action = ?');
    params.push(action);
  }

  const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  const totalRow = db
    .prepare(`SELECT COUNT(*) as cnt FROM audit_logs ${whereSql}`)
    .get(...params) as { cnt: number };

  const offset = (page - 1) * pageSize;
  const rows = db
    .prepare(`SELECT * FROM audit_logs ${whereSql} ORDER BY id DESC LIMIT ? OFFSET ?`)
    .all(...params, pageSize, offset);

  res.json({
    success: true,
    items: rows,
    total: totalRow.cnt,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(totalRow.cnt / pageSize)),
  });
});

// ============================================================================
// FUNNEL REPORT ENDPOINTS
// ============================================================================

function computeFunnelData(query: Record<string, unknown>) {
  const clauses: string[] = ['is_archived = 0'];
  const params: unknown[] = [];

  const filterKeys = ['pic', 'source', 'position', 'site', 'ob_month'];
  for (const k of filterKeys) {
    const val = String(query[k] ?? '').trim();
    if (val) {
      clauses.push(`${k} = ?`);
      params.push(val);
    }
  }

  const whereSql = `WHERE ${clauses.join(' AND ')}`;
  const rows = db
    .prepare(
      `SELECT pic, source, position, site, ob_date, ob_month, r1_stt, r2_stt, offer_status, ob_status, emp_status
       FROM candidates ${whereSql}`
    )
    .all(...params) as {
    pic: string;
    source: string;
    position: string;
    site: string;
    ob_date: string;
    ob_month: string;
    r1_stt: string;
    r2_stt: string;
    offer_status: string;
    ob_status: string;
    emp_status: string;
  }[];

  let leads = 0;
  let r1Passed = 0;
  let r2Passed = 0;
  let accepted = 0;
  let joined = 0;

  const byPic: Record<
    string,
    { key: string; leads: number; r1Passed: number; r2Passed: number; accepted: number; joined: number }
  > = {};
  const bySource: Record<
    string,
    { key: string; leads: number; r1Passed: number; r2Passed: number; accepted: number; joined: number }
  > = {};
  const byPosition: Record<
    string,
    { key: string; leads: number; r1Passed: number; r2Passed: number; accepted: number; joined: number }
  > = {};

  for (const r of rows) {
    leads += 1;
    const isR1 = r.r1_stt === 'Passed';
    const isR2 = r.r2_stt === 'Passed' || (isR1 && r.r2_stt === 'Not Required');
    const isAccepted = r.offer_status === 'Accepted' || r.ob_status === 'Accepted' || r.ob_status === 'Joined';
    const isJoined = r.ob_status === 'Joined';

    if (isR1) r1Passed += 1;
    if (isR2) r2Passed += 1;
    if (isAccepted) accepted += 1;
    if (isJoined) joined += 1;

    const addBucket = (
      map: Record<
        string,
        { key: string; leads: number; r1Passed: number; r2Passed: number; accepted: number; joined: number }
      >,
      k: string
    ) => {
      const label = k || '(Chưa phân loại)';
      if (!map[label]) {
        map[label] = { key: label, leads: 0, r1Passed: 0, r2Passed: 0, accepted: 0, joined: 0 };
      }
      map[label].leads += 1;
      if (isR1) map[label].r1Passed += 1;
      if (isR2) map[label].r2Passed += 1;
      if (isAccepted) map[label].accepted += 1;
      if (isJoined) map[label].joined += 1;
    };

    addBucket(byPic, r.pic);
    addBucket(bySource, r.source);
    addBucket(byPosition, r.position);
  }

  return {
    summary: {
      leads,
      r1Passed,
      r2Passed,
      accepted,
      joined,
    },
    byPic: Object.values(byPic).sort((a, b) => b.leads - a.leads),
    bySource: Object.values(bySource).sort((a, b) => b.leads - a.leads),
    byPosition: Object.values(byPosition).sort((a, b) => b.leads - a.leads),
  };
}

app.get('/api/reports/funnel', requireAuth, (req: Request, res: Response) => {
  const data = computeFunnelData(req.query as Record<string, unknown>);
  res.json({ success: true, ...data });
});

app.get('/api/reports/funnel/export.xlsx', requireAuth, (req: Request, res: Response) => {
  const data = computeFunnelData(req.query as Record<string, unknown>);
  const s = data.summary;
  const pct = (num: number, den: number) => (den > 0 ? `${((num / den) * 100).toFixed(1)}%` : '0.0%');

  const summaryRows = [
    ['BÁO CÁO PHỄU TUYỂN DỤNG (TA TRACKER FUNNEL)'],
    ['Giai đoạn (Stage)', 'Số lượng ứng viên', 'Tỷ lệ trên tổng Leads', 'Tỷ lệ chuyển đổi bước trước'],
    ['1. Tổng nguồn (Leads)', String(s.leads), '100.0%', '100.0%'],
    ['2. Đạt Vòng 1 (R1 Passed)', String(s.r1Passed), pct(s.r1Passed, s.leads), pct(s.r1Passed, s.leads)],
    ['3. Đạt Vòng 2 (R2 Passed)', String(s.r2Passed), pct(s.r2Passed, s.leads), pct(s.r2Passed, s.r1Passed)],
    ['4. Nhận Offer (Accepted)', String(s.accepted), pct(s.accepted, s.leads), pct(s.accepted, s.r2Passed)],
    ['5. Đã Onboard (Joined)', String(s.joined), pct(s.joined, s.leads), pct(s.joined, s.accepted)],
    [],
    ['CHI TIẾT THEO PIC PHỤ TRÁCH'],
    ['PIC', 'Leads', 'R1 Passed', 'R2 Passed', 'Accepted', 'Joined', 'Tỷ lệ Joined / Leads'],
    ...data.byPic.map((r) => [
      sanitizeCellForSpreadsheet(r.key),
      String(r.leads),
      String(r.r1Passed),
      String(r.r2Passed),
      String(r.accepted),
      String(r.joined),
      pct(r.joined, r.leads),
    ]),
    [],
    ['CHI TIẾT THEO NGUỒN TUYỂN DỤNG (SOURCE)'],
    ['Nguồn (Source)', 'Leads', 'R1 Passed', 'R2 Passed', 'Accepted', 'Joined', 'Tỷ lệ Joined / Leads'],
    ...data.bySource.map((r) => [
      sanitizeCellForSpreadsheet(r.key),
      String(r.leads),
      String(r.r1Passed),
      String(r.r2Passed),
      String(r.accepted),
      String(r.joined),
      pct(r.joined, r.leads),
    ]),
  ];

  const ws = XLSX.utils.aoa_to_sheet(summaryRows);
  ws['!cols'] = [{ wch: 32 }, { wch: 16 }, { wch: 18 }, { wch: 22 }, { wch: 15 }, { wch: 15 }, { wch: 20 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Funnel_Report');

  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  const todayIso = getTodayIsoInHoChiMinh();
  res.setHeader('Content-Disposition', `attachment; filename="TA_TRACKER_Funnel_${todayIso}.xlsx"`);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buf);
});

// ============================================================================
// ADMIN USERS MANAGEMENT ENDPOINTS
// ============================================================================

app.get('/api/users', requireAuth, requireAdmin, (_req: Request, res: Response) => {
  const users = db
    .prepare(
      'SELECT id, username, role, pic_code, full_name, must_change_password, active, created_at FROM users ORDER BY id ASC'
    )
    .all();
  res.json({ success: true, users });
});

app.post('/api/users', requireAuth, requireAdmin, (req: Request, res: Response) => {
  const username = String(req.body?.username ?? '').trim();
  const password = String(req.body?.password ?? '');
  const role = (req.body?.role === 'admin' ? 'admin' : 'pic') as 'admin' | 'pic';
  const picCode = String(req.body?.pic_code ?? '').trim();
  const fullName = String(req.body?.full_name ?? '').trim();

  if (!username || /\s/.test(username)) {
    res.status(400).json({
      success: false,
      error: { code: 'INVALID_USERNAME', message: 'Tên đăng nhập không được để trống hoặc chứa khoảng trắng.' },
    });
    return;
  }

  if (!password || password.length < 8) {
    res.status(400).json({
      success: false,
      error: { code: 'INVALID_PASSWORD', message: 'Mật khẩu khởi tạo phải từ 8 ký tự trở lên.' },
    });
    return;
  }

  if (role === 'pic' && !picCode) {
    res.status(400).json({
      success: false,
      error: { code: 'MISSING_PIC', message: 'Tài khoản vai trò PIC bắt buộc phải gán với một mã PIC trong danh mục.' },
    });
    return;
  }

  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (existing) {
    res.status(400).json({
      success: false,
      error: { code: 'DUPLICATE_USER', message: `Tên đăng nhập "${username}" đã tồn tại.` },
    });
    return;
  }

  const hash = bcrypt.hashSync(password, 10);
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO users (username, password_hash, role, pic_code, full_name, must_change_password, active, created_at)
     VALUES (?, ?, ?, ?, ?, 1, 1, ?)`
  ).run(username, hash, role, picCode, fullName || username, now);

  appendAuditLog({
    actorUsername: req.user!.username,
    actorRole: req.user!.role,
    action: 'USER',
    fieldKey: username,
    oldValue: '',
    newValue: `Tạo tài khoản mới (${role.toUpperCase()} - PIC: ${picCode || 'N/A'})`,
  });

  res.status(201).json({ success: true });
});

app.patch('/api/users/:id', requireAuth, requireAdmin, (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const targetUser = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as
    | { id: number; username: string; role: string; pic_code: string; active: number }
    | undefined;

  if (!targetUser) {
    res.status(404).json({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Không tìm thấy tài khoản người dùng.' },
    });
    return;
  }

  const role = req.body?.role !== undefined ? (req.body.role === 'admin' ? 'admin' : 'pic') : targetUser.role;
  const picCode = req.body?.pic_code !== undefined ? String(req.body.pic_code).trim() : targetUser.pic_code;
  const fullName = req.body?.full_name !== undefined ? String(req.body.full_name).trim() : undefined;
  const active = req.body?.active !== undefined ? (req.body.active ? 1 : 0) : targetUser.active;
  const resetPassword = req.body?.resetPassword ? String(req.body.resetPassword) : '';

  if (id === req.user!.id && active === 0) {
    res.status(400).json({
      success: false,
      error: { code: 'SELF_DISABLE', message: 'Bạn không thể tự khóa tài khoản đang đăng nhập của chính mình.' },
    });
    return;
  }

  if (fullName !== undefined) {
    db.prepare('UPDATE users SET role = ?, pic_code = ?, full_name = ?, active = ? WHERE id = ?').run(
      role,
      picCode,
      fullName,
      active,
      id
    );
  } else {
    db.prepare('UPDATE users SET role = ?, pic_code = ?, active = ? WHERE id = ?').run(
      role,
      picCode,
      active,
      id
    );
  }

  if (resetPassword) {
    if (resetPassword.length < 8) {
      res.status(400).json({
        success: false,
        error: { code: 'INVALID_PASSWORD', message: 'Mật khẩu đặt lại phải có ít nhất 8 ký tự.' },
      });
      return;
    }
    const newHash = bcrypt.hashSync(resetPassword, 10);
    db.prepare('UPDATE users SET password_hash = ?, must_change_password = 1 WHERE id = ?').run(newHash, id);
  }

  appendAuditLog({
    actorUsername: req.user!.username,
    actorRole: req.user!.role,
    action: 'USER',
    fieldKey: targetUser.username,
    oldValue: `${targetUser.role} / ${targetUser.pic_code} / active=${targetUser.active}`,
    newValue: `${role} / ${picCode} / active=${active}${resetPassword ? ' (Đặt lại mật khẩu)' : ''}`,
  });

  res.json({ success: true });
});

// ============================================================================
// SERVER STARTUP & LAN IP DISPLAY
// ============================================================================

async function startServer() {
  const port = Number(process.env.PORT) || 3000;
  const host = process.env.HOST || '0.0.0.0';
  const distPath = path.join(process.cwd(), 'dist');

  if (process.env.NODE_ENV === 'production' && fs.existsSync(distPath)) {
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  } else {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(port, host, () => {
    const nets = os.networkInterfaces();
    const lanUrls: string[] = [];
    for (const name of Object.keys(nets)) {
      for (const net of nets[name] || []) {
        if (net.family === 'IPv4' && !net.internal) {
          lanUrls.push(`http://${net.address}:${port}`);
        }
      }
    }
    console.log(`========================================================`);
    console.log(`  TA TRACKER Server đang chạy tại:`);
    console.log(`  - Local: http://localhost:${port}`);
    for (const url of lanUrls) {
      console.log(`  - LAN:   ${url}`);
    }
    console.log(`========================================================`);
  });
}

startServer();
