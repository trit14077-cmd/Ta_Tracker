// M8-3 – bộ đối chiếu ETL bảng Master ↔ cơ sở dữ liệu đích (DEV bản ẩn danh; dùng lại cho production khi cutover).
// Chạy (từ thư mục NEW, sau master.ts + loadDev.ts):
//   npx tsx scripts/migrate/reconcile.ts            # in kết quả, ghi etl-out/migrate/reconciliation_report.json
// CHỈ ĐỌC DB (PostgREST bằng SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY trong .env; không in khóa). Thoát mã 1 nếu có mục CHƯA ĐẠT.
// Các mục:
//   1. Số dòng + từng hồ sơ theo candidate_code (thiếu / thừa / trùng)
//   2. Từng ô ở các cột không bị ẩn danh (SAFE_COLUMNS) + hash từng cột; cột ẩn danh: số ô có giá trị
//   3. Phân bổ theo PIC / vị trí / nguồn / trạng thái
//   4. KPI: ETL ↔ đích (dashboardCalc.totals), RPC report_totals ↔ dashboardCalc trên toàn bộ dữ liệu đích,
//      và theo PIC / nguồn (groupTotals) cho toàn kỳ + tháng trước
//   5. Kanban: ETL ↔ đích (pipelineRules) và RPC board_counts ↔ pipelineRules trên toàn bộ dữ liệu đích
//   6. Quyền xem (RLS theo pic): pic lạ, pic chưa có tài khoản TA, hồ sơ chưa gán PIC
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { toDbValues } from '../../supabase/functions/records-save/logic.ts';
import { importCreatedAt } from '../../supabase/functions/records-import/logic.ts';
import { excelSerialToDateTime } from './anonymize.ts';
import {
  ALL_FROM, DIST_COLUMNS, SAFE_COLUMNS, boardCounts, columnHash, compareCounts, compareRows, distribution, flattenBoard,
  flattenGroups, flattenTotals, kpiGroups, kpiTotals, visibility, vnDate, type BoardCounts, type Row,
} from './reconcileLib.ts';
import { presetRange } from '../../shared/dashboardCalc.ts';

const dir = resolve('etl-out/migrate');
const PAGE = 1000;
const ANON_COLUMNS = ['full_name', 'phone', 'email', 'emp_id'];

function env(): Record<string, string> {
  const p = resolve('.env');
  if (!existsSync(p)) {
    console.error('Thiếu file .env (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY).');
    process.exit(2);
  }
  const o: Record<string, string> = {};
  for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m) o[m[1]] = m[2].replace(/^"|"$/g, '');
  }
  return o;
}

const e = env();
const H = { apikey: e.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${e.SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' };
async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const r = await fetch(`${e.SUPABASE_URL}/rest/v1/${path}`, { ...init, headers: { ...H, ...(init.headers ?? {}) } });
  const text = await r.text();
  if (!r.ok) throw new Error(`${init.method ?? 'GET'} ${path.split('?')[0]}: HTTP ${r.status} ${text.slice(0, 300)}`);
  return (text ? JSON.parse(text) : null) as T;
}
async function all<T>(path: string): Promise<T[]> {
  const out: T[] = [];
  for (let off = 0; ; off += PAGE) {
    const page = await api<T[]>(`${path}${path.includes('?') ? '&' : '?'}limit=${PAGE}&offset=${off}`);
    out.push(...page);
    if (page.length < PAGE) return out;
  }
}

const src = join(dir, 'master_records.jsonl');
if (!existsSync(src)) {
  console.error('Chưa có etl-out/migrate/master_records.jsonl – chạy scripts/migrate/master.ts trước.');
  process.exit(2);
}

const results: { name: string; ok: boolean; detail: unknown }[] = [];
const check = (name: string, ok: boolean, detail: unknown) => {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? 'ĐẠT ' : 'LỆCH'}  ${name}`);
};

try {
  const today = vnDate(new Date().toISOString());
  console.log(`Đích: ${e.SUPABASE_ENV || '(không ghi SUPABASE_ENV)'} – hôm nay (VN) ${today}`);

  // ---------- nguồn: kết quả ETL (giống dạng loadDev.ts gửi lên) ----------
  const etl = readFileSync(src, 'utf8').split('\n').filter(Boolean)
    .map((l) => (JSON.parse(l) as { values: Record<string, string> }).values);
  const source: Row[] = etl.map((v) => ({
    ...toDbValues(v), candidate_code: v.candidate_code, is_archived: false,
    created_at: importCreatedAt(excelSerialToDateTime(v.created_at ?? '')),
  }));

  // ---------- đích ----------
  const batches = await api<{ id: number; source: string }[]>('import_batches?source=like.etl:*&select=id,source&order=id');
  const batchIds = new Set(batches.map((b) => b.id));
  const cols = ['id', 'candidate_code', 'is_archived', 'created_at', 'import_batch_id', ...SAFE_COLUMNS, ...ANON_COLUMNS].join(',');
  const dbAll = await all<Row>(`recruitment_records?select=${cols}&order=id`);
  const target = dbAll.filter((r) => batchIds.has(Number(r.import_batch_id)));
  console.log(`Nguồn ETL ${source.length} hồ sơ · đích: ${dbAll.length} hồ sơ, trong đó ${target.length} thuộc lô ETL ${[...batchIds].join(', ') || '(không có)'}`);

  // Hồ sơ không đọc được Timestamp: lúc nạp DB lấy giờ nạp ⇒ dùng ngày tạo của đích cho phía nguồn (chỉ ảnh hưởng ngày lead)
  const createdOf = new Map(target.map((r) => [String(r.candidate_code), r.created_at]));
  let filledCreated = 0;
  for (const r of source) {
    if (!r.created_at) {
      r.created_at = createdOf.get(String(r.candidate_code)) ?? null;
      filledCreated++;
    }
  }

  console.log('Kết quả:');
  // 1–2. từng hồ sơ, từng ô
  const rc = compareRows(source, target);
  check('1. Số dòng và mã ứng viên (thiếu / thừa / trùng)', rc.source === rc.target && !rc.missing.length && !rc.extra.length && !rc.duplicateCodes.length,
    { source: rc.source, target: rc.target, missing: rc.missing.slice(0, 50), missing_count: rc.missing.length,
      extra: rc.extra.slice(0, 50), extra_count: rc.extra.length, duplicates: rc.duplicateCodes });
  const badCols = Object.entries(rc.columns).filter(([, d]) => d.mismatches > 0);
  check(`2a. Từng ô ở ${SAFE_COLUMNS.length} cột không ẩn danh`, badCols.length === 0, Object.fromEntries(badCols));
  const hashes = Object.fromEntries(SAFE_COLUMNS.map((c) => [c, { source: columnHash(source, c), target: columnHash(target, c) }]));
  check('2b. Hash từng cột', Object.values(hashes).every((h) => h.source === h.target), hashes);
  const filled = (rows: Row[], c: string) => rows.filter((r) => String(r[c] ?? '').trim() !== '').length;
  const anon = Object.fromEntries(ANON_COLUMNS.map((c) => [c, { source: filled(source, c), target: filled(target, c) }]));
  check('2c. Cột ẩn danh: số ô có giá trị', Object.values(anon).every((x) => x.source === x.target), anon);

  // 3. phân bổ
  const dist = Object.fromEntries(DIST_COLUMNS.map((c) => {
    const s = distribution(source, c);
    const t = distribution(target, c);
    return [c, { ...compareCounts(s, t), source: s }];
  }));
  check('3. Phân bổ theo PIC / vị trí / nguồn / trạng thái', Object.values(dist).every((d) => d.ok),
    Object.fromEntries(Object.entries(dist).map(([c, d]) => [c, d.ok ? 'khớp' : d.diffs])));

  // 4. KPI
  const kSrc = flattenTotals(kpiTotals(source, today));
  const kDst = flattenTotals(kpiTotals(target, today));
  const k1 = compareCounts(kSrc, kDst);
  check('4a. KPI toàn kỳ: ETL ↔ đích (dashboardCalc)', k1.ok, { source: kSrc, diffs: k1.diffs, filled_created_at: filledCreated });
  const serverKpi = await api<Record<string, number>>('rpc/report_totals', {
    method: 'POST', body: JSON.stringify({ p_from: ALL_FROM, p_to: today, p_filters: {}, p_group_by: 'none', p_today: today }),
  });
  const kAll = flattenTotals(kpiTotals(dbAll, today));
  const k2 = compareCounts(kAll, flattenTotals(serverKpi));
  check('4b. KPI: RPC report_totals ↔ dashboardCalc (toàn bộ đích)', k2.ok, { local: kAll, diffs: k2.diffs });

  // 4c. KPI theo PIC / theo nguồn – toàn kỳ và tháng trước (MIGRATION_PLAN §6)
  const [lmFrom, lmTo] = presetRange('lmonth', today, ALL_FROM);
  const groupDiffs: Record<string, unknown> = {};
  for (const [from, to, label] of [[ALL_FROM, today, 'toàn kỳ'], [lmFrom, lmTo, `tháng trước ${lmFrom}..${lmTo}`]] as const) {
    for (const g of ['pic', 'source'] as const) {
      const server = await api<[string, Record<string, number>][]>('rpc/report_totals', {
        method: 'POST', body: JSON.stringify({ p_from: from, p_to: to, p_filters: {}, p_group_by: g, p_today: today }),
      });
      const cmp = compareCounts(kpiGroups(dbAll, g, from, to, today), flattenGroups(server));
      if (!cmp.ok) groupDiffs[`${g} · ${label}`] = cmp.diffs;
    }
  }
  check('4c. KPI theo PIC / nguồn, toàn kỳ + tháng trước: RPC ↔ dashboardCalc', Object.keys(groupDiffs).length === 0, groupDiffs);

  // 5. Kanban
  const b1 = compareCounts(flattenBoard(boardCounts(source)), flattenBoard(boardCounts(target)));
  check('5a. Kanban: ETL ↔ đích (pipelineRules)', b1.ok, b1.diffs);
  const bAll = flattenBoard(boardCounts(dbAll));
  try {
    const serverBoard = await api<BoardCounts>('rpc/board_counts', { method: 'POST', body: JSON.stringify({ p_pic: '' }) });
    const b2 = compareCounts(bAll, flattenBoard(serverBoard));
    check('5b. Kanban: RPC board_counts ↔ pipelineRules (toàn bộ đích)', b2.ok, { local: bAll, diffs: b2.diffs });
  } catch (err) {
    const msg = (err as Error).message;
    check('5b. Kanban: RPC board_counts ↔ pipelineRules (toàn bộ đích)', false,
      { error: msg, hint: msg.includes('schema app') ? 'Chưa áp migration 0029 (service_role cần quyền schema app).' : '' });
    if (msg.includes('schema app')) console.log('        chưa kiểm được: cần áp migration 0029_service_role_app_usage lên DB đích');
  }

  // 6. quyền xem theo pic
  const pics = (await api<{ code: string }[]>('pics?select=code')).map((p) => p.code);
  const tas = (await api<{ pic_code: string | null }[]>('profiles?role=eq.pic&active=eq.true&select=pic_code'))
    .map((p) => p.pic_code ?? '').filter(Boolean);
  const vis = visibility(target, pics, tas);
  check('6. Quyền xem theo PIC (pic phải có trong danh mục)', vis.ok, vis);
  if (Object.keys(vis.picsWithoutUser).length) {
    console.log(`        cảnh báo: ${Object.keys(vis.picsWithoutUser).length} PIC có hồ sơ nhưng chưa có tài khoản TA đang hoạt động (tạm chỉ Admin thấy)`);
  }
  if (vis.noPic) console.log(`        thông tin: ${vis.noPic} hồ sơ chưa gán PIC (chỉ Admin thấy)`);

  const ok = results.every((r) => r.ok);
  const report = { at: new Date().toISOString(), target_env: e.SUPABASE_ENV ?? '', today, ok, results };
  writeFileSync(join(dir, 'reconciliation_report.json'), JSON.stringify(report, null, 2));
  console.log(`\n${ok ? 'ĐẠT' : 'CHƯA ĐẠT'} – ${results.filter((r) => r.ok).length}/${results.length} mục. Chi tiết: etl-out/migrate/reconciliation_report.json`);
  process.exit(ok ? 0 : 1);
} catch (err) {
  console.error('Lỗi đối chiếu:', (err as Error).message);
  process.exit(2);
}
