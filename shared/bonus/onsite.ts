/**
 * Task #10 (3) – TA Onsite Allowance. Quy tắc theo sheet "Onsite Allowance" của file TA_Credit_Bonus_<Mon><YY>.xlsx
 * (docs/bonus/PHAN_TICH_BONUS.md, không vào Git):
 *  - Admin đánh dấu ngày × TA (ô = 1 là ngày đó TA onsite). Tiền = số ngày onsite × ratePerDay (100.000).
 *  - Kỳ lương N trả các ngày onsite của CHÍNH tháng N (file Nov'26 dùng ngày 02–30/11, kể cả ngày sau ngày chốt –
 *    khác TA Credit là trả kết quả tháng trước).
 *  - Mỗi TA có ngày onsite một khoản / kỳ (part 'onsite', payee_type 'ta', ta_pic = PIC → TA tự xem được).
 *  - Cột của bảng nhập = TA có hồ sơ bonus đang bật và bật cờ Onsite (ta_bonus_profiles.onsite), cộng TA đã có ngày trong tháng.
 * DB: migration 0048 (bonus_onsite_days + cấu hình bonus_settings 'onsite').
 */
import { periodMonthRange, toIsoDate, type BonusLineInput } from './period.ts';
import type { TaProfile } from './taCredit.ts';

export interface OnsiteConfig {
  /** Đơn giá một ngày onsite (đ). */
  ratePerDay: number;
}

export const ONSITE_DEFAULT_CONFIG: OnsiteConfig = { ratePerDay: 100_000 };

export function cleanOnsiteConfig(raw: unknown): OnsiteConfig {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const rate = r.ratePerDay;
  return { ratePerDay: Number.isInteger(rate) && (rate as number) >= 0 ? (rate as number) : ONSITE_DEFAULT_CONFIG.ratePerDay };
}

/** Một ngày onsite đã lưu (bảng bonus_onsite_days). */
export interface OnsiteDay {
  pic: string;
  day: string;
}

const norm = (v: unknown) => String(v ?? '').normalize('NFC').trim();
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** 'Mon' … 'Sun' như TEXT(ngày, "ddd") của Excel. */
export function weekdayShort(dateIso: string): string {
  return WEEKDAYS[new Date(`${dateIso}T00:00:00Z`).getUTCDay()];
}

export function isWeekend(dateIso: string): boolean {
  const d = new Date(`${dateIso}T00:00:00Z`).getUTCDay();
  return d === 0 || d === 6;
}

/** Mọi ngày của tháng kỳ lương (ISO, tăng dần). */
export function monthDays(periodKey: string): string[] {
  const { from, to } = periodMonthRange(periodKey);
  const n = Number(to.slice(8, 10));
  return Array.from({ length: n }, (_, i) => `${from.slice(0, 8)}${String(i + 1).padStart(2, '0')}`);
}

/** Chuẩn hóa danh sách ngày: chỉ giữ ngày hợp lệ trong tháng kỳ, bỏ trùng, tăng dần. */
export function cleanOnsiteDays(days: unknown[], periodKey: string): string[] {
  const { from, to } = periodMonthRange(periodKey);
  return [...new Set(days.map(toIsoDate).filter((d) => d && d >= from && d <= to))].sort();
}

export interface OnsiteRow {
  pic: string;
  profile: TaProfile | null;
  days: string[];
  count: number;
  amount: number;
  /** '' = được trả; khác = lý do không tạo khoản (chỉ xét khi có ngày). */
  problem: '' | 'no_profile' | 'inactive';
}

export const ONSITE_PROBLEM_LABELS: Record<Exclude<OnsiteRow['problem'], ''>, string> = {
  no_profile: 'PIC chưa có hồ sơ bonus',
  inactive: 'Hồ sơ bonus đang tắt',
};

export interface OnsiteResult {
  rows: OnsiteRow[];
  lines: BonusLineInput[];
  totals: { amount: number; days: number; tas: number };
}

/** Các PIC hiện thành cột: hồ sơ bật + cờ Onsite, cộng PIC đã có ngày trong tháng (giữ thứ tự hồ sơ, rồi theo mã). */
export function onsitePics(profiles: TaProfile[], days: OnsiteDay[]): string[] {
  const out = profiles.filter((p) => p.active && p.onsite).map((p) => norm(p.pic));
  const extra = [...new Set(days.map((d) => norm(d.pic)))].filter((p) => p && !out.includes(p)).sort();
  return [...new Set(out), ...extra];
}

/** Tính kỳ `periodKey`: ngày onsite trong tháng N × đơn giá. Ngày ngoài tháng bị bỏ qua. */
export function buildOnsitePeriod(days: OnsiteDay[], profiles: TaProfile[], periodKey: string, cfg: OnsiteConfig): OnsiteResult {
  const byPic = new Map<string, unknown[]>();
  for (const d of days) {
    const k = norm(d.pic);
    if (k) byPic.set(k, [...(byPic.get(k) ?? []), d.day]);
  }
  const prof = new Map(profiles.map((p) => [norm(p.pic), p]));
  const rows: OnsiteRow[] = [];
  const lines: BonusLineInput[] = [];
  for (const pic of onsitePics(profiles, days)) {
    const ds = cleanOnsiteDays(byPic.get(pic) ?? [], periodKey);
    const p = prof.get(pic) ?? null;
    const problem: OnsiteRow['problem'] = !ds.length ? '' : !p ? 'no_profile' : !p.active ? 'inactive' : '';
    const amount = problem ? 0 : ds.length * cfg.ratePerDay;
    rows.push({ pic, profile: p, days: ds, count: ds.length, amount, problem });
    if (!ds.length || problem) continue;
    lines.push({
      record_id: null, part: 'onsite', payee_type: 'ta', payee_key: pic, payee_name: p!.name, emp_id: p!.emp_id, ta_pic: pic,
      amount, pit: 0, net: amount,
      detail: { month: periodKey, region: p!.region, title: p!.title, count: ds.length, rate: cfg.ratePerDay, days: ds },
    });
  }
  return {
    rows, lines,
    totals: {
      amount: lines.reduce((s, l) => s + l.amount, 0),
      days: lines.reduce((s, l) => s + Number(l.detail.count), 0),
      tas: lines.length,
    },
  };
}

/** Dựng lại các dòng của một kỳ đã chốt từ bonus_lines.detail. */
export function onsiteRowsFromLines(lines: Pick<BonusLineInput, 'payee_key' | 'payee_name' | 'emp_id' | 'amount' | 'detail'>[]): OnsiteRow[] {
  return lines.map((l) => {
    const d = (l.detail ?? {}) as Record<string, unknown>;
    const ds = Array.isArray(d.days) ? d.days.map(String) : [];
    return {
      pic: l.payee_key,
      profile: {
        pic: l.payee_key, name: l.payee_name, emp_id: l.emp_id, region: (d.region as TaProfile['region']) ?? '', level: '',
        title: String(d.title ?? ''), is_freelancer: false, onsite: true, active: true,
      },
      days: ds, count: Number(d.count ?? ds.length), amount: l.amount, problem: '',
    };
  });
}
