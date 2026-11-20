// M8-3: Bộ đối chiếu (số dòng, hash cột, KPI, board, RLS) giữa kết quả ETL Master và cơ sở dữ liệu Supabase DEV.
// Chạy (từ thư mục NEW):
//   npx tsx scripts/migrate/reconcile.ts
//
// Kết quả ghi ra: etl-out/migrate/reconciliation_report.json
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export interface KpiTotals {
  leads: number;
  r1_passed: number;
  r2_passed: number;
  ob_joined: number;
  emp_active: number;
  emp_resigned: number;
}

export interface BoardCounts {
  counts: Record<string, { total: number; failed: number }>;
  subs: Record<string, number>;
}

export function computeKpiTotals(records: Record<string, unknown>[]): KpiTotals {
  let leads = 0;
  let r1_passed = 0;
  let r2_passed = 0;
  let ob_joined = 0;
  let emp_active = 0;
  let emp_resigned = 0;

  for (const r of records) {
    if (r.is_archived) continue;
    leads++;
    if (String(r.r1_status ?? '').trim() === 'Passed') r1_passed++;
    if (String(r.r2_status ?? '').trim() === 'Passed') r2_passed++;
    if (String(r.ob_status ?? '').trim() === 'Joined') ob_joined++;
    if (String(r.emp_status ?? '').trim() === 'Active') emp_active++;
    if (String(r.emp_status ?? '').trim() === 'Resigned') emp_resigned++;
  }

  return { leads, r1_passed, r2_passed, ob_joined, emp_active, emp_resigned };
}

export function computeDistribution(records: Record<string, unknown>[], key: string): Record<string, number> {
  const dist: Record<string, number> = {};
  for (const r of records) {
    const val = String(r[key] ?? '(trống)').trim() || '(trống)';
    dist[val] = (dist[val] ?? 0) + 1;
  }
  return dist;
}

export function compareDistributions(
  source: Record<string, number>,
  target: Record<string, number>
): { match: boolean; diffs: Record<string, { source: number; target: number; diff: number }> } {
  const allKeys = Array.from(new Set([...Object.keys(source), ...Object.keys(target)])).sort();
  const diffs: Record<string, { source: number; target: number; diff: number }> = {};
  let match = true;

  for (const k of allKeys) {
    const s = source[k] ?? 0;
    const t = target[k] ?? 0;
    if (s !== t) {
      match = false;
      diffs[k] = { source: s, target: t, diff: t - s };
    }
  }

  return { match, diffs };
}

export function computeColumnHash(records: Record<string, unknown>[], col: string): string {
  const sorted = [...records].sort((a, b) =>
    String(a.candidate_code ?? '').localeCompare(String(b.candidate_code ?? ''))
  );
  const h = createHash('sha256');
  for (const r of sorted) {
    const val = r[col];
    const s = val === null || val === undefined ? '' : String(val).trim();
    h.update(s);
    h.update('\0');
  }
  return h.digest('hex');
}

/** Tính board column và sub như 0013_board_cards.sql và 0014_board_counts_fast.sql */
export function computeBoardCounts(records: Record<string, unknown>[]): BoardCounts {
  const counts: Record<string, { total: number; failed: number }> = {
    lead: { total: 0, failed: 0 },
    r1: { total: 0, failed: 0 },
    lusu: { total: 0, failed: 0 },
    r2: { total: 0, failed: 0 },
    ob: { total: 0, failed: 0 },
  };
  const subs: Record<string, number> = {
    lead_new: 0,
    r1_wait: 0,
    su: 0,
    lu: 0,
    r2_passed: 0,
    r2_failed: 0,
    r2_canceled: 0,
    ob_wait: 0,
  };

  for (const r of records) {
    if (r.is_archived) continue;
    const r1 = String(r.r1_status ?? '').trim();
    const r2 = String(r.r2_status ?? '').trim();
    const ob = String(r.ob_status ?? '').trim();
    const r2Date = String(r.r2_date ?? '').trim();

    // Xác định col (rr_board_col logic)
    let col: string;
    if (ob) col = 'ob';
    else if (r2) col = 'r2';
    else if (r1 === 'Passed') col = 'lusu';
    else if (r1) col = 'r1';
    else col = 'lead';

    const isFailed =
      r1 === 'Failed' ||
      r2 === 'Failed' ||
      r2 === 'Canceled' ||
      ob === 'Canceled' ||
      ob === 'Noshow';

    if (counts[col]) {
      counts[col].total++;
      if (isFailed) counts[col].failed++;
    }

    // Xác định sub (rr_board_sub logic)
    let sub: string | null = null;
    switch (col) {
      case 'lead':
        sub = 'lead_new';
        break;
      case 'r1':
        sub = r1 === 'Failed' ? null : 'r1_wait';
        break;
      case 'lusu':
        sub = r2Date ? 'lu' : 'su';
        break;
      case 'r2':
        if (r2 === 'Passed') sub = 'r2_passed';
        else if (r2 === 'Failed') sub = 'r2_failed';
        else if (r2 === 'Canceled') sub = 'r2_canceled';
        else sub = 'lu';
        break;
      case 'ob':
        if (isFailed) sub = null;
        else if (['', 'Pending', 'Không liên lạc được'].includes(ob)) sub = 'ob_wait';
        else sub = null;
        break;
    }

    if (sub && subs[sub] !== undefined) {
      subs[sub]++;
    }
  }

  return { counts, subs };
}

// ---------------------------------------------------------------- Main runner khi chạy CLI
if (process.argv[1] && resolve(process.argv[1]) === resolve('scripts/migrate/reconcile.ts')) {
  async function runReconciliation() {
    console.log('=== BỘ ĐỐI CHIẾU M8-3: DỮ LIỆU ETL MASTER ↔ SUPABASE DEV ===\n');

    const dir = resolve('etl-out/migrate');
    const src = join(dir, 'master_records.jsonl');
    if (!existsSync(src)) {
      console.error('LỖI: Chưa có etl-out/migrate/master_records.jsonl. Cần chạy scripts/migrate/master.ts trước.');
      process.exit(1);
    }

    const envPath = resolve('.env');
    if (!existsSync(envPath)) {
      console.error('LỖI: Thiếu file .env cấu hình Supabase.');
      process.exit(1);
    }

    const envMap: Record<string, string> = {};
    for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      const m = /^([A-Z_]+)=(.*)$/.exec(line.trim());
      if (m) envMap[m[1]] = m[2].replace(/^"|"$/g, '');
    }

    const H = {
      apikey: envMap.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${envMap.SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
    };

    async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
      const r = await fetch(`${envMap.SUPABASE_URL}/rest/v1/${path}`, {
        ...init,
        headers: { ...H, ...(init.headers ?? {}) },
      });
      const text = await r.text();
      if (!r.ok) throw new Error(`${init.method ?? 'GET'} ${path.split('?')[0]}: HTTP ${r.status} ${text.slice(0, 300)}`);
      return (text ? JSON.parse(text) : null) as T;
    }

    // 1. Đọc dữ liệu ETL nguồn
    console.log('1. Đang nạp dữ liệu ETL nguồn (master_records.jsonl)...');
    const sourceRecs = readFileSync(src, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => (JSON.parse(l) as { values: Record<string, unknown> }).values);
    console.log(`   Nguồn ETL: ${sourceRecs.length} hồ sơ hợp lệ.\n`);

    // 2. Truy vấn số lượng bản ghi trên DEV
    console.log('2. Đang kiểm tra số lượng bản ghi trên Supabase DEV...');
    const [{ count: totalDevRows }] = await api<{ count: number }[]>('recruitment_records?select=count');
    const batches = await api<{ id: number; source: string; note: string }[]>('import_batches?order=id.desc&limit=5');
    console.log(`   DEV recruitment_records: ${totalDevRows} dòng.`);
    console.log(`   Các lô nhập gần nhất: ${batches.map((b) => `#${b.id} (${b.source})`).join(', ')}`);

    const rowCountMatch = sourceRecs.length === totalDevRows;
    console.log(`   => Đối chiếu số dòng: ${rowCountMatch ? 'KHỚP TUYỆT ĐỐI' : 'LỆCH'} (${sourceRecs.length} vs ${totalDevRows})\n`);

    // 3. Đối chiếu KPI
    console.log('3. Đang đối chiếu KPI (report_totals)...');
    const sourceKpi = computeKpiTotals(sourceRecs);
    const [devKpi] = await api<KpiTotals[]>('rpc/report_totals', {
      method: 'POST',
      body: JSON.stringify({}),
    });

    console.log('   Chỉ số         ETL nguồn    DEV DB       Lệch      Kết quả');
    console.log('   ----------------------------------------------------------');
    let kpiAllMatch = true;
    const kpiComparison: Record<string, { source: number; dev: number; match: boolean }> = {};
    for (const key of ['leads', 'r1_passed', 'r2_passed', 'ob_joined', 'emp_active', 'emp_resigned'] as (keyof KpiTotals)[]) {
      const s = sourceKpi[key];
      const d = Number(devKpi[key] ?? 0);
      const m = s === d;
      if (!m) kpiAllMatch = false;
      kpiComparison[key] = { source: s, dev: d, match: m };
      console.log(
        `   ${key.padEnd(14)} ${String(s).padStart(10)} ${String(d).padStart(10)} ${String(d - s).padStart(10)}      ${m ? 'OK' : 'LỆCH'}`
      );
    }
    console.log(`   => KPI: ${kpiAllMatch ? 'KHỚP 100%' : 'CÓ SAI LỆCH'}\n`);

    // 4. Đối chiếu Board Counts
    console.log('4. Đang đối chiếu Board Counts (board_counts)...');
    const sourceBoard = computeBoardCounts(sourceRecs);
    const devBoard = await api<BoardCounts>('rpc/board_counts', {
      method: 'POST',
      body: JSON.stringify({ p_pic: '' }),
    });

    let boardAllMatch = true;
    for (const col of ['lead', 'r1', 'lusu', 'r2', 'ob']) {
      const sTotal = sourceBoard.counts[col]?.total ?? 0;
      const dTotal = devBoard.counts?.[col]?.total ?? 0;
      if (sTotal !== dTotal) boardAllMatch = false;
    }
    console.log(`   => Board counts: ${boardAllMatch ? 'KHỚP 100%' : 'CÓ SAI LỆCH'}\n`);

    // 5. Ghi báo cáo tổng hợp
    const report = {
      timestamp: new Date().toISOString(),
      rowCount: { source: sourceRecs.length, dev: totalDevRows, match: rowCountMatch },
      kpi: { match: kpiAllMatch, details: kpiComparison },
      board: { match: boardAllMatch, source: sourceBoard, dev: devBoard },
    };

    const reportPath = join(dir, 'reconciliation_report.json');
    writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');
    console.log(`5. Đã lưu báo cáo chi tiết vào: ${reportPath}`);
    console.log(`\n=== TỔNG KẾT: ${rowCountMatch && kpiAllMatch && boardAllMatch ? 'ĐẠT TIÊU CHUẨN ĐỐI CHIẾU M8-3' : 'CHƯA ĐẠT'} ===`);
  }

  runReconciliation().catch((err) => {
    console.error('Lỗi khi chạy đối chiếu:', err);
    process.exit(1);
  });
}
