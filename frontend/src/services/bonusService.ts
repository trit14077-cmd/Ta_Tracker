// Bonus hàng tháng (task #8–#10). Bảng + RPC ở migration 0045; quy tắc tính ở shared/bonus/*.ts.
// Đọc theo RLS: admin thấy tất cả; TA chỉ thấy khoản có ta_pic = PIC của mình. Ghi chỉ qua RPC (admin).
import { supabase } from '../lib/supabase.ts';
import { downloadXlsxBook } from './xlsxDownload.ts';
import { periodShort, type BonusKind, type BonusLineInput } from '../../../shared/bonus/period.ts';
import { cleanReferralRates, referralMom, type ReferralPaidMap, type ReferralRates, type ReferralRow, type ReferralSource, type YesNo } from '../../../shared/bonus/referral.ts';
import {
  REFERRAL_LIST_WIDTHS,
  referralListSheet,
  referralListSheetName,
  referralMomSheet,
  referralSummarySheet,
} from '../../../shared/bonus/referralTemplate.ts';

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
};
