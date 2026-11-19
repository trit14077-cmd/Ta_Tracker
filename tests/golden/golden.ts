// M1-3: bộ hồ sơ GIẢ (sinh cố định từ seed) + kết quả do logic dùng chung tính ra.
// Dùng làm "oracle" cho M5-1/M5-2 (RPC SQL phải ra đúng các số này) và chặn thay đổi ngoài ý muốn ở shared/.
// shared/ là bản chép nguyên văn OLD/src/shared (đã so từng byte ngày 19/11/2026) nên kết quả = kết quả code cũ.
import { totals, rates, retention, groupTotals, trend, type ReportRow } from '../../shared/dashboardCalc.ts';
import { boardPosition, boardSub, lockedFieldKeys } from '../../shared/pipelineRules.ts';
import { currentStage } from '../../shared/stage.ts';
import { REASON_RULES } from '../../shared/reasonRules.ts';
import { computeTenor } from '../../shared/validation.ts';

export const TODAY = '2026-11-19';
export const RANGES: Record<string, [string, string]> = {
  all: ['2026-01-01', '2026-11-19'],
  q3: ['2026-07-01', '2026-09-30'],
  oct: ['2026-10-01', '2026-10-31'],
  nov_mtd: ['2026-11-01', '2026-11-19'],
};

function prng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const day0 = Date.UTC(2026, 5, 1); // 2026-06-01
const iso = (d: number) => new Date(day0 + d * 86400000).toISOString().slice(0, 10);

export type Rec = Record<string, string>;

/** Hồ sơ giả: không có tên/SĐT, chỉ các cột dùng cho pipeline và báo cáo. */
export function makeRecords(n = 400, seed = 20261119): Rec[] {
  const r = prng(seed);
  const pick = <T,>(xs: T[]) => xs[Math.floor(r() * xs.length)];
  const reason = (round: 'r1' | 'r2' | 'ob', status: string) => {
    const xs = REASON_RULES[round][status] || [];
    return xs.length && r() < 0.8 ? pick(xs) : '';
  };
  const out: Rec[] = [];
  for (let i = 0; i < n; i++) {
    const lead = Math.floor(r() * 168); // 2026-06-01 .. 2026-11-15
    const c: Rec = {
      candidate_code: 'G' + String(i + 1).padStart(5, '0'),
      pic: pick(['PIC-A', 'PIC-B', 'PIC-C', 'PIC-D', '']),
      site: pick(['Kho 1', 'Kho 2', 'Kho 3']), region: pick(['Vùng Bắc', 'Vùng Nam']), dept: pick(['Phòng X', 'Phòng Y']),
      position: pick(['Vị trí 1', 'Vị trí 2']), source: pick(['Nguồn 1', 'Nguồn 2']), sub_source: pick(['Kênh a', 'Kênh b', 'Kênh c']),
      lead_date: iso(lead),
      r1_date: '', r1_status: '', r1_sub_status: '', r2_date: '', r2_status: '', r2_sub_status: '',
      ob_date: '', ob_status: '', ob_sub_status: '', emp_status: '', attrition_date: '',
    };
    let d = lead;
    const until = 171; // 2026-11-19
    if (r() < 0.85) {
      d += 1 + Math.floor(r() * 5);
      if (d <= until) {
        c.r1_date = iso(d);
        c.r1_status = pick(['Passed', 'Passed', 'Passed', 'Failed', 'Pending', 'KIV', 'Không liên lạc được', '']);
        if (c.r1_status === '' && r() < 0.5) c.r1_date = ''; // có trường hợp chưa có gì
        c.r1_sub_status = c.r1_status ? reason('r1', c.r1_status) : '';
      }
    }
    if (c.r1_status === 'Passed' && r() < 0.8) {
      d += 2 + Math.floor(r() * 10);
      if (d <= until) {
        c.r2_date = iso(d);
        c.r2_status = pick(['Passed', 'Passed', 'Failed', 'Canceled', 'Pending', 'KIV', '']);
        c.r2_sub_status = c.r2_status ? reason('r2', c.r2_status) : '';
      }
    }
    if (c.r2_status === 'Passed' && r() < 0.85) {
      d += 3 + Math.floor(r() * 14);
      if (d <= until + 7) {
        c.ob_date = iso(d);
        c.ob_status = d > until ? pick(['Accepted', 'Pending']) : pick(['Joined', 'Joined', 'Joined', 'Noshow', 'Canceled', 'Accepted', 'Pending', 'Không liên lạc được']);
        c.ob_sub_status = reason('ob', c.ob_status);
        if (c.ob_status === 'Joined') {
          if (r() < 0.45) {
            const a = d + Math.floor(r() * 90);
            if (a <= until) {
              c.emp_status = 'Resigned';
              c.attrition_date = iso(a);
            } else c.emp_status = 'Active';
          } else c.emp_status = 'Active';
        }
      }
    }
    out.push(c);
  }
  return out;
}

export function toReportRow(c: Rec): ReportRow {
  return {
    pic: c.pic, site: c.site, region: c.region, dept: c.dept, position: c.position, source: c.source, subSource: c.sub_source,
    lead: c.lead_date, r1d: c.r1_date, r1s: c.r1_status, r1r: c.r1_sub_status,
    r2d: c.r2_date, r2s: c.r2_status, r2r: c.r2_sub_status,
    obd: c.ob_date, obs: c.ob_status, obr: c.ob_sub_status, emp: c.emp_status, attd: c.attrition_date,
  };
}

/** Mọi kết quả cần đối chiếu, tính từ logic dùng chung. */
export function computeOutputs(recs: Rec[]) {
  const rows = recs.map(toReportRow);
  const perRecord = recs.map((c) => ({
    code: c.candidate_code,
    stage: currentStage(c),
    board: boardPosition(c),
    sub: boardSub(c),
    locked: lockedFieldKeys(c).length,
    tenor: computeTenor(c.ob_date, c.emp_status, c.attrition_date, TODAY),
  }));
  const byRange = Object.fromEntries(
    Object.entries(RANGES).map(([k, [f, t]]) => {
      const tt = totals(rows, f, t, TODAY);
      return [k, { from: f, to: t, totals: tt, rates: rates(tt), retention: retention(tt) }];
    }),
  );
  const [af, at] = RANGES.all;
  return {
    today: TODAY,
    perRecord,
    byRange,
    byPic: groupTotals(rows, (x) => x.pic, af, at, TODAY),
    trend: trend(rows, af, at),
  };
}
