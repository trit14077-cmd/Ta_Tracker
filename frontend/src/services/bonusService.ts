// Bonus hàng tháng (task #8–#10). Bảng + RPC ở migration 0045; quy tắc tính ở shared/bonus/*.ts.
// Đọc theo RLS: admin thấy tất cả; TA chỉ thấy khoản có ta_pic = PIC của mình. Ghi chỉ qua RPC (admin).
import { supabase } from '../lib/supabase.ts';
import { downloadXlsxBook } from './xlsxDownload.ts';
import { periodMonthRange, periodShort, type BonusKind, type BonusLineInput } from '../../../shared/bonus/period.ts';
import { cleanReferralRates, referralMom, type ReferralPaidMap, type ReferralRates, type ReferralRow, type ReferralSource, type YesNo } from '../../../shared/bonus/referral.ts';
import {
  REFERRAL_LIST_WIDTHS,
  referralListSheet,
  referralListSheetName,
  referralMomSheet,
  referralSummarySheet,
} from '../../../shared/bonus/referralTemplate.ts';
import {
  cleanSignonFlag,
  cleanSignonScheme,
  signonMom,
  type SignonFlag,
  type SignonPaidMap,
  type SignonRow,
  type SignonScheme,
  type SignonSource,
} from '../../../shared/bonus/signon.ts';
import {
  SIGNON_PERIOD_WIDTHS,
  signonDetailsSheet,
  signonDetailsWidths,
  signonPeriodSheet,
  signonPeriodSheetName,
  signonSummarySheet,
} from '../../../shared/bonus/signonTemplate.ts';

import {
  cleanTaCreditConfig,
  type TaCreditConfig,
  type TaCreditOb,
  type TaCreditRow,
  type TaCreditSource,
  type TaLevel,
  type TaProfile,
  type TaRegion,
} from '../../../shared/bonus/taCredit.ts';
import { OB_LIST_WIDTHS, TA_BONUS_WIDTHS, obListSheet, obListSheetName, taBonusSheet, taBonusSheetName } from '../../../shared/bonus/taCreditTemplate.ts';
import { cleanOnsiteConfig, type OnsiteConfig, type OnsiteDay, type OnsiteRow } from '../../../shared/bonus/onsite.ts';
import { ONSITE_SHEET_NAME, onsiteSheet, onsiteSheetWidths } from '../../../shared/bonus/onsiteTemplate.ts';
import {
  cleanFreelancerConfig,
  cleanFreelancerFlag,
  type Freelancer,
  type FreelancerConfig,
  type FreelancerFlag,
  type FreelancerLineView,
  type FreelancerPaidMap,
  type FreelancerSource,
} from '../../../shared/bonus/freelancer.ts';
import {
  FREELANCER_SHEET_NAME,
  FREELANCER_SUMMARY_SHEET_NAME,
  FREELANCER_SUMMARY_WIDTHS,
  FREELANCER_WIDTHS,
  freelancerSheet,
  freelancerSummarySheet,
} from '../../../shared/bonus/freelancerTemplate.ts';

/** Một PIC kèm hồ sơ bonus (has_profile = đã có dòng ta_bonus_profiles). */
export interface TaProfileRow extends TaProfile {
  has_profile: boolean;
  pic_active: boolean;
  note: string;
}

/** Sửa tay một hồ sơ Sign-on: scheme ('' = tự gán), cờ từng mốc, ghi chú. */
export interface SignonPatch {
  scheme_code?: string;
  flags?: Record<string, SignonFlag>;
  note?: string;
}

export interface BonusPeriod {
  id: number;
  kind: BonusKind;
  period_key: string;
  status: 'mo' | 'da_chot';
  asof_date: string | null;
  config: Record<string, unknown>;
  locked_at: string | null;
}

export interface BonusLine extends BonusLineInput {
  id: number;
  period_id: number;
  kind: BonusKind;
}

export interface MyBonusLine extends BonusLine {
  bonus_periods: { kind: BonusKind; period_key: string; status: string } | null;
}

const BONUS_ERRORS: [string, string][] = [
  ['FORBIDDEN', 'Chỉ Admin được thực hiện thao tác này.'],
  ['BONUS_ALREADY_LOCKED', 'Kỳ này đã chốt. Mở lại kỳ trước khi chốt lại.'],
  ['BONUS_NOT_LOCKED', 'Kỳ này chưa chốt.'],
  ['BONUS_REASON_REQUIRED', 'Cần ghi lý do.'],
  ['BONUS_ALREADY_PAID', 'Có hồ sơ đã được chốt ở kỳ khác:'],
  ['BONUS_DUPLICATE_LINE', 'Có hồ sơ bị tính hai lần trong kỳ:'],
  ['BONUS_PART_LOCKED', 'Phần này đã chốt ở một kỳ. Mở lại kỳ đó trước khi sửa.'],
  ['BONUS_BAD_PERIOD', 'Kỳ lương không hợp lệ.'],
  ['BONUS_BAD_KIND', 'Loại bonus không hợp lệ.'],
  ['INVALID_INPUT', 'Dữ liệu không hợp lệ.'],
  ['NOT_FOUND', 'Không tìm thấy hồ sơ.'],
];

function bonusError(e: { message?: string; code?: string; details?: string | null } | null, fallback: string): Error {
  const msg = e?.message ?? '';
  const hit = BONUS_ERRORS.find(([code]) => msg.includes(code));
  if (hit) return new Error(hit[1].endsWith(':') && e?.details ? `${hit[1]} ${e.details}` : hit[1]);
  if (e?.code === '42501') return new Error('Bạn không có quyền thực hiện thao tác này.');
  return new Error(fallback);
}

const LINE_COLS = 'id, period_id, kind, record_id, part, payee_type, payee_key, payee_name, emp_id, ta_pic, amount, pit, net, detail';
const toNum = (l: BonusLine): BonusLine => ({ ...l, amount: Number(l.amount), pit: Number(l.pit), net: Number(l.net) });

function stamp(): string {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}

export const bonusService = {
  async settings(kind: BonusKind): Promise<unknown> {
    const { data, error } = await supabase.from('bonus_settings').select('config').eq('kind', kind).maybeSingle();
    if (error) throw bonusError(error, 'Không tải được cấu hình bonus.');
    return data?.config ?? null;
  },

  async saveSettings(kind: BonusKind, config: Record<string, unknown>): Promise<void> {
    const { error } = await supabase.rpc('bonus_settings_save', { p_kind: kind, p_config: config });
    if (error) throw bonusError(error, 'Không lưu được cấu hình bonus.');
  },

  async periods(kind: BonusKind): Promise<BonusPeriod[]> {
    const { data, error } = await supabase.from('bonus_periods')
      .select('id, kind, period_key, status, asof_date, config, locked_at').eq('kind', kind).order('period_key', { ascending: false });
    if (error) throw bonusError(error, 'Không tải được danh sách kỳ.');
    return (data ?? []) as BonusPeriod[];
  },

  async lines(periodIds: number[]): Promise<BonusLine[]> {
    if (!periodIds.length) return [];
    const { data, error } = await supabase.from('bonus_lines').select(LINE_COLS).in('period_id', periodIds).order('id').limit(20000);
    if (error) throw bonusError(error, 'Không tải được các khoản đã chốt.');
    return ((data ?? []) as unknown as BonusLine[]).map(toNum);
  },

  /** Bonus của chính TA đang đăng nhập (RLS lọc theo ta_pic). */
  async myLines(): Promise<MyBonusLine[]> {
    const { data, error } = await supabase.from('bonus_lines')
      .select(`${LINE_COLS}, bonus_periods(kind, period_key, status)`).not('ta_pic', 'is', null).order('id', { ascending: false }).limit(2000);
    if (error) throw bonusError(error, 'Không tải được bonus của bạn.');
    return ((data ?? []) as unknown as MyBonusLine[]).map((l) => ({ ...toNum(l), bonus_periods: l.bonus_periods }));
  },

  async lock(kind: BonusKind, period: string, asof: string, lines: BonusLineInput[]): Promise<{ count: number; total: number }> {
    const { data, error } = await supabase.rpc('bonus_lock', { p_kind: kind, p_period: period, p_asof: asof, p_lines: lines });
    if (error) throw bonusError(error, 'Không chốt được kỳ.');
    const d = data as { count: number; total: number | string };
    return { count: d.count, total: Number(d.total) };
  },

  async reopen(kind: BonusKind, period: string, reason: string): Promise<void> {
    const { error } = await supabase.rpc('bonus_reopen', { p_kind: kind, p_period: period, p_reason: reason });
    if (error) throw bonusError(error, 'Không mở lại được kỳ.');
  },

  // ---------------- Referral (task #8) ----------------
  async referralRates(): Promise<ReferralRates> {
    return cleanReferralRates(await bonusService.settings('referral'));
  },

  /** Hồ sơ Referral đã Joined có OBD từ `fromDate`, kèm thông tin người giới thiệu. */
  async referralSources(fromDate: string): Promise<ReferralSource[]> {
    const { data, error } = await supabase.from('recruitment_records')
      .select('id, candidate_code, full_name, emp_id, rank, region, site, ob_date, emp_status, attrition_date, pic')
      .eq('sub_source', 'Referrals').eq('ob_status', 'Joined').eq('is_archived', false).gte('ob_date', fromDate)
      .order('ob_date').limit(5000);
    if (error) throw bonusError(error, 'Không tải được danh sách Referral.');
    const recs = (data ?? []) as Record<string, unknown>[];
    const ids = recs.map((r) => Number(r.id));
    const refs = new Map<number, Record<string, unknown>>();
    for (let i = 0; i < ids.length; i += 500) {
      const { data: d2, error: e2 } = await supabase.from('bonus_referrals').select('*').in('record_id', ids.slice(i, i + 500));
      if (e2) throw bonusError(e2, 'Không tải được thông tin người giới thiệu.');
      for (const b of (d2 ?? []) as Record<string, unknown>[]) refs.set(Number(b.record_id), b);
    }
    const s = (v: unknown) => (v == null ? '' : String(v));
    return recs.map((r) => {
      const b = refs.get(Number(r.id)) ?? {};
      return {
        record_id: Number(r.id), candidate_code: s(r.candidate_code), full_name: s(r.full_name), emp_id: s(r.emp_id), rank: s(r.rank),
        region: s(r.region), dc: s(r.site), ob_date: (r.ob_date as string) ?? null, emp_status: s(r.emp_status),
        attrition_date: (r.attrition_date as string) ?? null, pic: (r.pic as string) ?? null,
        referrer_name: s(b.referrer_name), referrer_emp_id: s(b.referrer_emp_id), referrer_rank: s(b.referrer_rank),
        referrer_dc: s(b.referrer_dc), referrer_status: s(b.referrer_status), referrer_last_day: (b.referrer_last_day as string) ?? null,
        disciplinary: Boolean(b.disciplinary), candidate_eligible: s(b.candidate_eligible) as YesNo,
        referrer_eligible: s(b.referrer_eligible) as YesNo, note: s(b.note),
      };
    });
  },

  async saveReferral(recordId: number, patch: Partial<ReferralSource>): Promise<void> {
    const { error } = await supabase.rpc('bonus_referral_save', { p_record_id: recordId, p: patch });
    if (error) throw bonusError(error, 'Không lưu được thông tin Referral.');
  },

  /** Phần đã chốt của từng hồ sơ: record_id → { candidate: kỳ, referrer: kỳ }. */
  referralPaid(periods: BonusPeriod[], lines: BonusLine[]): ReferralPaidMap {
    const key = new Map(periods.map((p) => [p.id, p.period_key]));
    const m: ReferralPaidMap = new Map();
    for (const l of lines) {
      if (l.record_id == null || (l.part !== 'candidate' && l.part !== 'referrer')) continue;
      const k = key.get(l.period_id);
      if (!k) continue;
      m.set(l.record_id, { ...(m.get(l.record_id) ?? {}), [l.part]: k });
    }
    return m;
  },

  async exportReferral(period: string, rows: ReferralRow[], lines: BonusLineInput[], periods: BonusPeriod[], allLines: BonusLine[]): Promise<void> {
    const locked = periods.filter((p) => p.status === 'da_chot').sort((a, b) => a.period_key.localeCompare(b.period_key));
    const mom = referralMom(locked.map((p) => ({ period: p.period_key, lines: allLines.filter((l) => l.period_id === p.id) })));
    await downloadXlsxBook(`Referral_Payment_${periodShort(period).replace("'", '')}_${stamp()}.xlsx`, [
      { name: referralListSheetName(period), rows: referralListSheet(rows), widths: REFERRAL_LIST_WIDTHS },
      { name: 'Summary', rows: referralSummarySheet(lines, period), widths: [2, 5, 12, 26, 16, 16, 2, 5, 12, 26, 16, 16, 2, 40, 14] },
      { name: 'MoM', rows: referralMomSheet(mom), widths: [10, 8, 12, 10, 14, 24] },
    ]);
  },

  // ---------------- Sign-on (task #9) ----------------
  async signonSchemes(): Promise<SignonScheme[]> {
    const { data, error } = await supabase.from('bonus_signon_schemes').select('*').order('effective_from');
    if (error) throw bonusError(error, 'Không tải được danh sách scheme Sign-on.');
    const out: SignonScheme[] = [];
    for (const r of (data ?? []) as Record<string, unknown>[]) {
      const { scheme } = cleanSignonScheme(r);
      if (scheme) out.push(scheme);
    }
    return out;
  },

  async saveSignonScheme(s: SignonScheme): Promise<void> {
    const { error } = await supabase.rpc('bonus_signon_scheme_save', { p: { ...s, effective_to: s.effective_to ?? '' } });
    if (error) throw bonusError(error, 'Không lưu được scheme Sign-on.');
  },

  /** Hồ sơ đã Joined tại các site có scheme, OBD từ `fromDate`, kèm scheme / cờ admin sửa tay. Lọc Rank 6 ở shared/bonus. */
  async signonSources(fromDate: string, sites: string[]): Promise<SignonSource[]> {
    if (!sites.length) return [];
    const { data, error } = await supabase.from('recruitment_records')
      .select('id, candidate_code, full_name, emp_id, rank, site, ob_date, emp_status, attrition_date, pic')
      .eq('ob_status', 'Joined').eq('is_archived', false).in('site', sites).gte('ob_date', fromDate)
      .order('ob_date').limit(5000);
    if (error) throw bonusError(error, 'Không tải được danh sách Sign-on.');
    const recs = (data ?? []) as Record<string, unknown>[];
    const ids = recs.map((r) => Number(r.id));
    const extra = new Map<number, Record<string, unknown>>();
    for (let i = 0; i < ids.length; i += 500) {
      const { data: d2, error: e2 } = await supabase.from('bonus_signon_records').select('*').in('record_id', ids.slice(i, i + 500));
      if (e2) throw bonusError(e2, 'Không tải được cờ Sign-on.');
      for (const b of (d2 ?? []) as Record<string, unknown>[]) extra.set(Number(b.record_id), b);
    }
    const s = (v: unknown) => (v == null ? '' : String(v));
    return recs.map((r) => {
      const b = extra.get(Number(r.id)) ?? {};
      const flags: Record<string, SignonFlag> = {};
      for (let k = 1; k <= 6; k++) {
        const f = cleanSignonFlag(b[`m${k}_flag`]);
        if (f) flags[`m${k}`] = f;
      }
      return {
        record_id: Number(r.id), candidate_code: s(r.candidate_code), full_name: s(r.full_name), emp_id: s(r.emp_id), rank: s(r.rank),
        dc: s(r.site), ob_date: (r.ob_date as string) ?? null, emp_status: s(r.emp_status),
        attrition_date: (r.attrition_date as string) ?? null, pic: (r.pic as string) ?? null,
        scheme_code: s(b.scheme_code), flags, note: s(b.note),
      };
    });
  },

  async saveSignon(recordId: number, patch: SignonPatch): Promise<void> {
    const p: Record<string, string> = {};
    if (patch.scheme_code !== undefined) p.scheme_code = patch.scheme_code;
    if (patch.note !== undefined) p.note = patch.note;
    for (const [k, v] of Object.entries(patch.flags ?? {})) p[`${k}_flag`] = v;
    const { error } = await supabase.rpc('bonus_signon_save', { p_record_id: recordId, p });
    if (error) throw bonusError(error, 'Không lưu được thông tin Sign-on.');
  },

  /** Mốc đã chốt của từng hồ sơ: record_id → { m1: { period, amount } … }. `lines` = khoản của các kỳ Sign-on. */
  signonPaid(periods: BonusPeriod[], lines: BonusLine[]): SignonPaidMap {
    const key = new Map(periods.map((p) => [p.id, p.period_key]));
    const m: SignonPaidMap = new Map();
    for (const l of lines) {
      const k = key.get(l.period_id);
      if (l.record_id == null || !k || !/^m\d$/.test(l.part)) continue;
      m.set(l.record_id, { ...(m.get(l.record_id) ?? {}), [l.part]: { period: k, amount: l.amount } });
    }
    return m;
  },

  async exportSignon(period: string, rows: SignonRow[], all: SignonRow[], periods: BonusPeriod[], allLines: BonusLine[]): Promise<void> {
    const locked = periods.filter((p) => p.status === 'da_chot').sort((a, b) => a.period_key.localeCompare(b.period_key));
    const keys = [...new Set([...locked.map((p) => p.period_key).filter((k) => k <= period), period])].sort();
    const mom = signonMom(locked.map((p) => ({ period: p.period_key, lines: allLines.filter((l) => l.period_id === p.id) })));
    await downloadXlsxBook(`Sign-on_Bonus_Payment_${periodShort(period).replace("'", '')}_${stamp()}.xlsx`, [
      { name: 'Sign-on Details', rows: signonDetailsSheet(all, keys), widths: signonDetailsWidths(all, keys) },
      { name: signonPeriodSheetName(period), rows: signonPeriodSheet(rows, period), widths: SIGNON_PERIOD_WIDTHS },
      { name: 'summary', rows: signonSummarySheet(mom), widths: [10, 16, 14, 16] },
    ]);
  },

  // ---------------- TA Credit (task #10 phần 2) ----------------
  async taCreditConfig(): Promise<TaCreditConfig> {
    return cleanTaCreditConfig(await bonusService.settings('ta_credit'));
  },

  /** Mọi PIC + hồ sơ bonus (admin thấy tất cả; TA chỉ thấy hồ sơ của mình theo RLS). */
  async taProfiles(): Promise<TaProfileRow[]> {
    const [pics, profs] = await Promise.all([
      supabase.from('pics').select('code, name, active').order('sort_order').order('code'),
      supabase.from('ta_bonus_profiles').select('*'),
    ]);
    if (pics.error) throw bonusError(pics.error, 'Không tải được danh sách PIC.');
    if (profs.error) throw bonusError(profs.error, 'Không tải được hồ sơ bonus TA.');
    const m = new Map(((profs.data ?? []) as Record<string, unknown>[]).map((p) => [String(p.pic_code), p]));
    const s = (v: unknown) => (v == null ? '' : String(v));
    return ((pics.data ?? []) as Record<string, unknown>[]).map((p) => {
      const b = m.get(String(p.code));
      return {
        pic: s(p.code), name: s(p.name), pic_active: p.active !== false, has_profile: Boolean(b),
        emp_id: s(b?.emp_id), region: s(b?.region) as TaRegion | '', level: s(b?.level) as TaLevel | '', title: s(b?.title),
        is_freelancer: Boolean(b?.is_freelancer), onsite: Boolean(b?.onsite), active: b ? b.active !== false : false, note: s(b?.note),
      };
    });
  },

  async saveTaProfile(p: Omit<TaProfileRow, 'name' | 'has_profile' | 'pic_active'>): Promise<void> {
    const { pic, ...rest } = p;
    const { error } = await supabase.rpc('ta_bonus_profile_save', { p: { pic_code: pic, ...rest } });
    if (error) throw bonusError(error, 'Không lưu được hồ sơ bonus TA.');
  },

  /** OB Joined có OBD trong tháng `perfMonth` ('YYYY-MM'). */
  async taCreditSources(perfMonth: string): Promise<TaCreditSource[]> {
    const { from, to } = periodMonthRange(perfMonth);
    const { data, error } = await supabase.from('recruitment_records')
      .select('id, candidate_code, full_name, emp_id, pic, rank, region, unit, site, ob_date, ob_status, emp_status, attrition_date')
      .eq('ob_status', 'Joined').eq('is_archived', false).gte('ob_date', from).lte('ob_date', to)
      .order('ob_date').limit(5000);
    if (error) throw bonusError(error, 'Không tải được danh sách OB.');
    const s = (v: unknown) => (v == null ? '' : String(v));
    return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
      record_id: Number(r.id), candidate_code: s(r.candidate_code), full_name: s(r.full_name), emp_id: s(r.emp_id),
      pic: (r.pic as string) ?? null, rank: s(r.rank), region: s(r.region), unit: s(r.unit), site: s(r.site),
      ob_date: (r.ob_date as string) ?? null, ob_status: s(r.ob_status), emp_status: s(r.emp_status), attrition_date: (r.attrition_date as string) ?? null,
    }));
  },

  async exportTaCredit(period: string, perfMonth: string, rows: TaCreditRow[], obs: TaCreditOb[]): Promise<void> {
    await downloadXlsxBook(`TA_Credit_Bonus_${periodShort(period).replace("'", '')}_${stamp()}.xlsx`, [
      { name: taBonusSheetName(period), rows: taBonusSheet(rows, period), widths: TA_BONUS_WIDTHS },
      { name: obListSheetName(perfMonth), rows: obListSheet(obs), widths: OB_LIST_WIDTHS },
    ]);
  },

  // ---------------- Onsite (task #10 phần 3) ----------------
  async onsiteConfig(): Promise<OnsiteConfig> {
    return cleanOnsiteConfig(await bonusService.settings('onsite'));
  },

  /** Ngày onsite trong tháng `month` ('YYYY-MM'). */
  async onsiteDays(month: string): Promise<OnsiteDay[]> {
    const { from, to } = periodMonthRange(month);
    const { data, error } = await supabase.from('bonus_onsite_days').select('pic_code, day')
      .gte('day', from).lte('day', to).order('day').limit(5000);
    if (error) throw bonusError(error, 'Không tải được ngày onsite.');
    return ((data ?? []) as { pic_code: string; day: string }[]).map((r) => ({ pic: r.pic_code, day: r.day }));
  },

  /** Thay toàn bộ ngày onsite của một TA trong tháng. */
  async saveOnsiteDays(pic: string, month: string, days: string[]): Promise<void> {
    const { error } = await supabase.rpc('bonus_onsite_set', { p_pic: pic, p_month: month, p_days: days });
    if (error) throw bonusError(error, 'Không lưu được ngày onsite.');
  },

  async exportOnsite(period: string, rows: OnsiteRow[], rate: number): Promise<void> {
    const n = rows.filter((r) => r.count > 0 && !r.problem).length;
    await downloadXlsxBook(`TA_Onsite_Allowance_${periodShort(period).replace("'", '')}_${stamp()}.xlsx`, [
      { name: ONSITE_SHEET_NAME, rows: onsiteSheet(rows, period, rate), widths: onsiteSheetWidths(n) },
    ]);
  },

  // ---------------- Freelancer (task #10 phần 4) ----------------
  async freelancerConfig(): Promise<FreelancerConfig> {
    return cleanFreelancerConfig(await bonusService.settings('freelancer'));
  },

  async freelancers(): Promise<Freelancer[]> {
    const { data, error } = await supabase.from('bonus_freelancers').select('id, name, phone, region, note, active').order('name').limit(5000);
    if (error) throw bonusError(error, 'Không tải được danh sách CTV.');
    return ((data ?? []) as Record<string, unknown>[]).map((f) => ({
      id: Number(f.id), name: String(f.name ?? ''), phone: String(f.phone ?? ''), region: String(f.region ?? '') as Freelancer['region'],
      note: String(f.note ?? ''), active: f.active !== false,
    }));
  },

  /** id = null → tạo CTV mới. Trả id. */
  async saveFreelancer(f: Omit<Freelancer, 'id'> & { id: number | null }): Promise<number> {
    const { data, error } = await supabase.rpc('bonus_freelancer_save', { p: f });
    if (error) {
      if (error.details === 'duplicate') throw new Error('Đã có CTV cùng tên và số điện thoại.');
      throw bonusError(error, 'Không lưu được CTV.');
    }
    return Number((data as { id: number }).id);
  },

  /**
   * Hồ sơ nguồn Freelancer đã Joined có OBD từ `fromDate`, cộng mọi hồ sơ đã gán CTV (kể cả cũ hơn hoặc nguồn khác),
   * kèm CTV / cờ / ghi chú admin nhập.
   */
  async freelancerSources(fromDate: string): Promise<FreelancerSource[]> {
    const COLS = 'id, candidate_code, full_name, emp_id, position, site, sub_source, pic, ob_date, ob_status, emp_status, attrition_date';
    const [recent, links] = await Promise.all([
      supabase.from('recruitment_records').select(COLS)
        .eq('sub_source', 'Freelancer').eq('ob_status', 'Joined').eq('is_archived', false).gte('ob_date', fromDate)
        .order('ob_date').limit(5000),
      supabase.from('bonus_freelancer_records').select('record_id, freelancer_id, flag, note').limit(20000),
    ]);
    if (recent.error) throw bonusError(recent.error, 'Không tải được danh sách hồ sơ Freelancer.');
    if (links.error) throw bonusError(links.error, 'Không tải được thông tin CTV của hồ sơ.');
    const recs = new Map(((recent.data ?? []) as Record<string, unknown>[]).map((r) => [Number(r.id), r]));
    const link = new Map(((links.data ?? []) as Record<string, unknown>[]).map((l) => [Number(l.record_id), l]));
    const missing = [...link.entries()].filter(([id, l]) => l.freelancer_id != null && !recs.has(id)).map(([id]) => id);
    for (let i = 0; i < missing.length; i += 500) {
      const { data, error } = await supabase.from('recruitment_records').select(COLS).eq('is_archived', false).in('id', missing.slice(i, i + 500));
      if (error) throw bonusError(error, 'Không tải được danh sách hồ sơ Freelancer.');
      for (const r of (data ?? []) as Record<string, unknown>[]) recs.set(Number(r.id), r);
    }
    const s = (v: unknown) => (v == null ? '' : String(v));
    return [...recs.values()].map((r) => {
      const l = link.get(Number(r.id));
      return {
        record_id: Number(r.id), candidate_code: s(r.candidate_code), full_name: s(r.full_name), emp_id: s(r.emp_id), position: s(r.position),
        site: s(r.site), sub_source: s(r.sub_source), pic: (r.pic as string) ?? null, ob_date: (r.ob_date as string) ?? null,
        ob_status: s(r.ob_status), emp_status: s(r.emp_status), attrition_date: (r.attrition_date as string) ?? null,
        freelancer_id: l?.freelancer_id == null ? null : Number(l.freelancer_id), flag: cleanFreelancerFlag(l?.flag), note: s(l?.note),
      };
    }).sort((a, b) => String(a.ob_date).localeCompare(String(b.ob_date)) || a.record_id - b.record_id);
  },

  async saveFreelancerRecord(recordId: number, patch: { freelancer_id?: number | null; flag?: FreelancerFlag; note?: string }): Promise<void> {
    const { error } = await supabase.rpc('bonus_freelancer_record_save', { p_record_id: recordId, p: patch });
    if (error) throw bonusError(error, 'Không lưu được thông tin CTV của hồ sơ.');
  },

  /** Hồ sơ đã chốt ở các kỳ Freelancer: record_id → { period, amount }. */
  freelancerPaid(periods: BonusPeriod[], lines: BonusLine[]): FreelancerPaidMap {
    const key = new Map(periods.map((p) => [p.id, p.period_key]));
    const m: FreelancerPaidMap = new Map();
    for (const l of lines) {
      const k = key.get(l.period_id);
      if (l.record_id != null && k && l.part === 'freelancer') m.set(l.record_id, { period: k, amount: l.amount });
    }
    return m;
  },

  async exportFreelancer(period: string, views: FreelancerLineView[]): Promise<void> {
    await downloadXlsxBook(`Freelancer_Bonus_${periodShort(period).replace("'", '')}_${stamp()}.xlsx`, [
      { name: FREELANCER_SHEET_NAME, rows: freelancerSheet(views, period), widths: FREELANCER_WIDTHS },
      { name: FREELANCER_SUMMARY_SHEET_NAME, rows: freelancerSummarySheet(views), widths: FREELANCER_SUMMARY_WIDTHS },
    ]);
  },
};
