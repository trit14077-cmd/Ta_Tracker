/**
 * Bonus hàng tháng (task #8–#10) – phần dùng chung: kỳ lương, nhãn kỳ, ngày, khoản tiền chốt.
 * Quy tắc nghiệp vụ đã chốt ngày 27/11/2026 (docs/bonus/PHAN_TICH_BONUS.md, không vào Git):
 *  - Kỳ lương 'YYYY-MM' (Nov'26 Pay Period = '2026-11'). Một kỳ gồm các khoản đến hạn tới NGÀY CHỐT của kỳ
 *    mà chưa được trả ở kỳ đã chốt trước đó (Sign-on / Freelancer đến mốc trễ thì vào kỳ sau).
 *  - Mọi mốc ngày tính theo NGÀY LỊCH (giống công thức Excel: Join Date + 6 …).
 * DB: migration 0045 (bonus_settings / bonus_periods / bonus_lines). Chốt kỳ = client tính bằng các hàm ở đây
 * rồi gửi khoản tiền qua RPC bonus_lock (chỉ admin).
 */

export const BONUS_KINDS = ['referral', 'signon', 'ta_credit', 'onsite', 'freelancer'] as const;
export type BonusKind = (typeof BONUS_KINDS)[number];

export const PAYEE_TYPES = ['candidate', 'referrer', 'employee', 'ta', 'freelancer'] as const;
export type PayeeType = (typeof PAYEE_TYPES)[number];

/** Một khoản tiền gửi lên khi chốt kỳ (= một dòng bonus_lines). amount = tiền gộp; net = amount − pit. */
export interface BonusLineInput {
  record_id: number | null;
  /** Phần của hồ sơ: 'candidate' / 'referrer' (Referral), 'm1'…'m4' (Sign-on)… Một hồ sơ + phần chỉ trả một lần. */
  part: string;
  payee_type: PayeeType;
  /** Khóa gom nhóm người nhận (Emp_ID, mã PIC, id CTV). */
  payee_key: string;
  payee_name: string;
  emp_id: string;
  /** Mã PIC khi người nhận là TA (để TA tự xem bonus của mình). */
  ta_pic: string | null;
  amount: number;
  pit: number;
  net: number;
  detail: Record<string, unknown>;
}

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n: number) => String(n).padStart(2, '0');

export function isPeriodKey(key: unknown): key is string {
  return typeof key === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(key);
}

function parts(key: string): [number, number] {
  if (!isPeriodKey(key)) throw new Error(`Kỳ lương không hợp lệ: ${key}`);
  return [Number(key.slice(0, 4)), Number(key.slice(5, 7))];
}

/** "Nov'26" */
export function periodShort(key: string): string {
  const [y, m] = parts(key);
  return `${MON[m - 1]}'${String(y).slice(2)}`;
}

/** "Nov'26 Pay Period" – đúng chữ trong cột Payment Status của file Excel. */
export function periodLabel(key: string): string {
  return `${periodShort(key)} Pay Period`;
}

/** Ngược lại của periodLabel / periodShort: "Nov'26 Pay Period", "Nov'26", "Nov'2026" → '2026-11'. Không nhận ra → ''. */
export function periodKeyOfLabel(label: unknown): string {
  const m = /^\s*([A-Za-z]{3})'(\d{2}|\d{4})\b/.exec(String(label ?? ''));
  if (!m) return '';
  const mi = MON.findIndex((x) => x.toLowerCase() === m[1].toLowerCase());
  if (mi < 0) return '';
  const y = m[2].length === 2 ? 2000 + Number(m[2]) : Number(m[2]);
  return `${y}-${pad(mi + 1)}`;
}

export function shiftPeriod(key: string, months: number): string {
  const [y, m] = parts(key);
  const t = y * 12 + (m - 1) + months;
  return `${Math.floor(t / 12)}-${pad((t % 12) + 1)}`;
}

/** Kỳ của một ngày ISO theo tháng lịch ('2026-11-26' → '2026-11'). */
export function periodOfDate(dateIso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-\d{2}/.exec(String(dateIso ?? ''));
  return m && isPeriodKey(`${m[1]}-${m[2]}`) ? `${m[1]}-${m[2]}` : '';
}

/** n kỳ gần nhất, mới nhất trước, tính từ kỳ `from`. */
export function recentPeriodKeys(n: number, from: string): string[] {
  return Array.from({ length: n }, (_, i) => shiftPeriod(from, -i));
}

/** Ngày đầu / cuối tháng của kỳ (ISO). */
export function periodMonthRange(key: string): { from: string; to: string } {
  const [y, m] = parts(key);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${y}-${pad(m)}-01`, to: `${y}-${pad(m)}-${pad(last)}` };
}

// ---- ngày ISO (không múi giờ, tính bằng UTC để không lệch ngày)
const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isIsoDate(v: unknown): v is string {
  if (typeof v !== 'string' || !ISO_RE.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

/** Chuẩn hóa về 'YYYY-MM-DD' (nhận cả '2026-11-26T…'); sai → ''. */
export function toIsoDate(v: unknown): string {
  const s = String(v ?? '').slice(0, 10);
  return isIsoDate(s) ? s : '';
}

export function addDays(dateIso: string, days: number): string {
  const d = new Date(`${dateIso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Số ngày lịch từ a đến b (b − a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

/** Ngày dd/mm/yyyy để hiển thị. */
export function displayDateVn(dateIso: string | null | undefined): string {
  const s = toIsoDate(dateIso);
  return s ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : '';
}

/** 17000000 → "17.000.000" */
export function fmtVnd(n: number): string {
  return Math.round(n || 0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/** Tiền: số nguyên không âm; khác → null. */
export function cleanAmount(v: unknown): number | null {
  const n = typeof v === 'number' ? v : Number(String(v ?? '').replace(/[.,\s]/g, ''));
  return Number.isFinite(n) && n >= 0 && Number.isInteger(n) ? n : null;
}

/** Tổng amount / pit / net của các khoản. */
export function sumLines(lines: Pick<BonusLineInput, 'amount' | 'pit' | 'net'>[]): { amount: number; pit: number; net: number } {
  return lines.reduce((s, l) => ({ amount: s.amount + l.amount, pit: s.pit + l.pit, net: s.net + l.net }), { amount: 0, pit: 0, net: 0 });
}

/** Gom theo người nhận (payee_key; trống thì theo tên), giữ thứ tự xuất hiện. */
export function groupByPayee<T extends Pick<BonusLineInput, 'payee_key' | 'payee_name' | 'amount'>>(lines: T[]): { key: string; name: string; amount: number; lines: T[] }[] {
  const m = new Map<string, { key: string; name: string; amount: number; lines: T[] }>();
  for (const l of lines) {
    const k = l.payee_key || `name:${l.payee_name}`;
    const g = m.get(k) ?? { key: l.payee_key, name: l.payee_name, amount: 0, lines: [] };
    g.amount += l.amount;
    g.lines.push(l);
    m.set(k, g);
  }
  return [...m.values()];
}
