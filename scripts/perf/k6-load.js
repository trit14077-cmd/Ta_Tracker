// M9-2 – kiểm thử tải: 20 người dùng đồng thời trên 20.000 hồ sơ giả (đọc / lưu / Kanban / báo cáo).
// Chạy trên project Supabase THỬ NGHIỆM riêng (đã apply migrations + perf_seed.sql) – KHÔNG chạy trên DEV/PROD.
// Hướng dẫn đầy đủ: docs/RUNBOOK.md §6.
//
//   k6 run -e SUPABASE_URL=https://<ref>.supabase.co -e SUPABASE_ANON_KEY=<khóa publishable/anon> \
//          -e K6_USERS_FILE=../../etl-out/k6_users.json [-e K6_WRITE=1 -e K6_ALLOW_WRITE_HOST=<ref>.supabase.co] \
//          [-e K6_VUS=20 -e K6_DURATION=5m -e K6_TODAY=2026-11-22] scripts/perf/k6-load.js
//
// K6_USERS_FILE: JSON [{"email": "...", "password": "..."}] – tài khoản THỬ NGHIỆM (TA + ≥1 Admin), đặt NGOÀI Git.
// "Trang" = các lời gọi song song mà màn hình thật gửi khi mở; thời gian trang = từ lúc gửi tới khi nhận đủ.
// Ngưỡng = bảng "Tiêu chí nghiệm thu" (IMPLEMENTATION_TASKS): Dashboard P95 < 3 s, Danh sách P95 < 2 s,
// Kanban P95 < 1 s (API; UI dùng optimistic update), lỗi < 1 %, không mất bản ghi.
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Trend } from 'k6/metrics';

const URL = (__ENV.SUPABASE_URL || '').replace(/\/$/, '');
const ANON = __ENV.SUPABASE_ANON_KEY || '';
const USERS = __ENV.K6_USERS_FILE ? JSON.parse(open(__ENV.K6_USERS_FILE)) : [];
const HOST = URL.replace(/^https?:\/\//, '');
// Ghi chỉ khi người chạy khai báo lại đúng host đích là project thử nghiệm (tránh ghi nhầm DEV/PROD)
const WRITE = __ENV.K6_WRITE === '1' && __ENV.K6_ALLOW_WRITE_HOST === HOST;
const TODAY = __ENV.K6_TODAY || new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
const YEAR_START = `${TODAY.slice(0, 4)}-01-01`;

const pageList = new Trend('page_list', true);
const pageDashboard = new Trend('page_dashboard', true);
const pageKanban = new Trend('page_kanban', true);
const pageAlerts = new Trend('page_alerts', true);
const saveRecord = new Trend('save_record', true);
const lostWrites = new Counter('lost_writes');
const savesOk = new Counter('saves_ok');

export const options = {
  scenarios: {
    users: { executor: 'constant-vus', vus: Number(__ENV.K6_VUS || 20), duration: __ENV.K6_DURATION || '5m' },
  },
  thresholds: {
    page_dashboard: ['p(95)<3000'],
    page_list: ['p(95)<2000'],
    page_kanban: ['p(95)<1000'],
    http_req_failed: ['rate<0.01'],
    checks: ['rate>0.99'],
    lost_writes: ['count==0'],
  },
  setupTimeout: '120s',
};

const hdr = (jwt) => ({ headers: { apikey: ANON, Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' } });
const rpc = (name, args, jwt) => ['POST', `${URL}/rest/v1/rpc/${name}`, JSON.stringify(args), hdr(jwt)];

function months12() {
  const out = [];
  const [y, m] = TODAY.split('-').map(Number);
  for (let i = 11; i >= 0; i--) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    const e = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
    out.push([d.toISOString().slice(0, 10), e.toISOString().slice(0, 10)]);
  }
  return out;
}

export function setup() {
  if (!URL || !ANON || !USERS.length) throw new Error('Thiếu SUPABASE_URL / SUPABASE_ANON_KEY / K6_USERS_FILE');
  if (__ENV.K6_WRITE === '1' && !WRITE) throw new Error('K6_WRITE=1 cần K6_ALLOW_WRITE_HOST = host của SUPABASE_URL (project thử nghiệm)');
  const sessions = [];
  for (const u of USERS) {
    const r = http.post(`${URL}/auth/v1/token?grant_type=password`, JSON.stringify(u), { headers: { apikey: ANON, 'Content-Type': 'application/json' } });
    if (r.status !== 200) throw new Error(`Đăng nhập lỗi ${r.status} (${u.email.replace(/^(..).*@/, '$1***@')})`);
    const jwt = r.json('access_token');
    const me = http.get(`${URL}/rest/v1/profiles?select=id,role,pic_code&limit=1`, hdr(jwt)).json()[0];
    let records = [];
    if (WRITE) {
      // hồ sơ người này được sửa; mỗi VU giữ RIÊNG 1 hồ sơ ⇒ 409 nghĩa là mất/ghi đè bản ghi
      const q = me.role === 'admin' ? '' : `&pic=eq.${encodeURIComponent(me.pic_code)}`;
      records = http.get(`${URL}/rest/v1/v_records?select=id,row_version&is_archived=eq.false${q}&order=id.asc&limit=200`, hdr(jwt)).json();
    }
    sessions.push({ jwt, role: me.role, pic: me.pic_code || '', records });
  }
  return { sessions };
}

// trạng thái riêng của từng VU (k6: biến module là riêng mỗi VU)
let mine = null;

function pickSession(data) {
  const n = data.sessions.length;
  const s = data.sessions[(__VU - 1) % n];
  if (WRITE && mine === null) {
    const slot = Math.floor((__VU - 1) / n);
    const rec = s.records[slot];
    mine = rec ? { id: rec.id, version: Number(rec.row_version) } : false;
  }
  return s;
}

function timed(trend, reqs, tag) {
  const t0 = Date.now();
  const res = http.batch(reqs);
  trend.add(Date.now() - t0);
  check(res, { [`${tag}: mọi lời gọi 200`]: (rs) => rs.every((r) => r.status === 200) });
  return res;
}

function listPage(s) {
  const page = 1 + Math.floor(Math.random() * 20);
  const search = Math.random() < 0.25 ? 'văn' : '';
  timed(pageList, [
    rpc('list_candidates', { p_page: page, p_page_size: 25, p_sort_by: 'id', p_sort_dir: 'desc', p_search: search, p_filters: {} }, s.jwt),
    rpc('board_counts', { p_pic: '' }, s.jwt),
  ], 'Danh sách');
}

function dashboardPage(s) {
  timed(pageDashboard, [
    rpc('report_meta', { p_today: TODAY }, s.jwt),
    rpc('report_totals', { p_from: YEAR_START, p_to: TODAY, p_filters: {}, p_group_by: 'none', p_today: TODAY }, s.jwt),
    rpc('report_series', { p_periods: months12(), p_filters: {}, p_today: TODAY }, s.jwt),
    rpc('report_trend', { p_from: YEAR_START, p_to: TODAY, p_filters: {} }, s.jwt),
    rpc('report_reasons', { p_from: YEAR_START, p_to: TODAY, p_filters: {} }, s.jwt),
    rpc('report_counts', { p_filters: {} }, s.jwt),
  ], 'Dashboard');
}

function kanbanPage(s) {
  timed(pageKanban, [rpc('board_page', { p_filters: {}, p_q: '' }, s.jwt)], 'Kanban');
  if (Math.random() < 0.3) {
    timed(pageKanban, [rpc('board_cards', { p_col: 'r1', p_offset: 30, p_filters: {}, p_q: '' }, s.jwt)], 'Kanban tải thêm');
  }
}

function alertsCall(s) {
  timed(pageAlerts, [rpc('alerts', { p_today: TODAY }, s.jwt)], 'Chuông');
}

function save(s) {
  if (!mine) return listPage(s); // không đủ hồ sơ riêng cho VU này ⇒ đọc thay vì ghi
  const note = `k6 VU${__VU} lần ${__ITER}`;
  const t0 = Date.now();
  const r = http.post(`${URL}/functions/v1/records-save`,
    JSON.stringify({ op: 'patch', id: mine.id, expected_version: mine.version, changes: { r1_note: note } }), hdr(s.jwt));
  saveRecord.add(Date.now() - t0);
  if (r.status === 200) {
    const rec = r.json('record') || {};
    const okv = Number(rec.row_version) === mine.version + 1 && rec.r1_note === note;
    check(r, { 'Lưu: version +1 và giá trị đúng': () => okv });
    if (!okv) lostWrites.add(1);
    mine.version = Number(rec.row_version);
    savesOk.add(1);
  } else if (r.status === 409) {
    // mỗi VU giữ riêng hồ sơ ⇒ lệch version nghĩa là có ghi bị mất / ghi đè ngoài ý muốn
    lostWrites.add(1);
    check(r, { 'Lưu: không 409': () => false });
    const cur = r.json('error.details.current') || {};
    mine.version = Number(cur.row_version) || mine.version;
  } else {
    check(r, { [`Lưu: HTTP ${r.status}`]: () => false });
  }
}

export default function (data) {
  const s = pickSession(data);
  const x = Math.random();
  // tỉ lệ thao tác ước lượng của 1 TA trong giờ làm việc
  if (x < 0.35) listPage(s);
  else if (x < 0.55) kanbanPage(s);
  else if (x < 0.70) dashboardPage(s);
  else if (x < 0.80) alertsCall(s);
  else if (WRITE) save(s);
  else listPage(s);
  sleep(1 + Math.random() * 2); // thời gian người dùng đọc màn hình
}
