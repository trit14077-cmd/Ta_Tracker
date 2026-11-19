// M5-3: dữ liệu trang Báo cáo (OverviewDashboard + TaCharts) lấy từ RPC tổng hợp ở server (0011, 0012) thay cho
// /api/reports/rows (tải toàn bộ dòng rồi tính ở trình duyệt). Số liệu = dashboardCalc.ts (report_parity_test).
// Target OB/tháng: app_settings.ob_target (Admin ghi, mọi người đọc) – thay Script Properties "obTarget".
import { supabase } from '../lib/supabase.ts';
import { ApiError } from './candidateService.ts';
import type { Period, PeriodTotals, SourcePeriod, Totals, TrendPoint } from '../../../shared/dashboardCalc.ts';
import { cleanFilters, type ReportFilters, type ReportReasons } from './reportAdapters.ts';

export type { ReportFilters, ReportReasons } from './reportAdapters.ts';

export type OptionKey = 'pic' | 'site' | 'source' | 'sub_source' | 'region' | 'dept' | 'position';
export interface ReportMeta {
  today: string;
  minDate: string;
  options: Record<OptionKey, string[]>;
}

async function rpc<T>(fn: string, args: Record<string, unknown>, what: string): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new ApiError(`Không tải được ${what}.`, 500, error.code || 'REPORT_FAILED');
  return data as T;
}

const span = (ps: Period[]) => ps.map((p) => [p.from, p.to]);
const viSort = (xs: string[]) => [...xs].sort((a, b) => a.localeCompare(b, 'vi'));

export const reportService = {
  /** Hôm nay (giờ VN), ngày nhỏ nhất (= MIN_DATE) và các giá trị cho ô lọc, trên toàn bộ hồ sơ được xem. */
  async getMeta(): Promise<ReportMeta> {
    const m = await rpc<{ today: string; min_date: string | null; options: Record<OptionKey, string[]> }>('report_meta', {}, 'thông tin báo cáo');
    const options = {} as Record<OptionKey, string[]>;
    for (const k of ['pic', 'site', 'source', 'sub_source', 'region', 'dept', 'position'] as OptionKey[]) options[k] = viSort(m.options?.[k] || []);
    return { today: m.today, minDate: m.min_date || '', options };
  },

  async getCounts(filters: ReportFilters): Promise<{ all: number; filtered: number }> {
    return rpc('report_counts', { p_filters: cleanFilters(filters) }, 'số hồ sơ');
  },

  /** = totals(rows, from, to, today) */
  async getTotals(from: string, to: string, filters: ReportFilters, today: string): Promise<Totals> {
    return rpc('report_totals', { p_from: from, p_to: to, p_filters: cleanFilters(filters), p_group_by: 'none', p_today: today }, 'số liệu báo cáo');
  },

  /** = groupTotals(rows, r => r[dim], from, to, today); dim theo tên cột DB (sub_source, không phải subSource). */
  async getGroupTotals(from: string, to: string, filters: ReportFilters, dim: OptionKey, today: string): Promise<[string, Totals][]> {
    return rpc('report_totals', { p_from: from, p_to: to, p_filters: cleanFilters(filters), p_group_by: dim, p_today: today }, 'hiệu suất theo nhóm');
  },

  /** = trend(rows, from, to) */
  async getTrend(from: string, to: string, filters: ReportFilters): Promise<TrendPoint[]> {
    return rpc('report_trend', { p_from: from, p_to: to, p_filters: cleanFilters(filters) }, 'xu hướng theo tháng');
  },

  /** Lý do cho 5 biểu đồ tròn (ghép bằng donutsFromReasons). */
  async getReasons(from: string, to: string, filters: ReportFilters): Promise<ReportReasons> {
    return rpc('report_reasons', { p_from: from, p_to: to, p_filters: cleanFilters(filters) }, 'lý do');
  },

  /** = periodSeries(rows, ps, today) */
  async getPeriodSeries(ps: Period[], filters: ReportFilters, today: string): Promise<PeriodTotals[]> {
    if (!ps.length) return [];
    const ts = await rpc<Totals[]>('report_series', { p_periods: span(ps), p_filters: cleanFilters(filters), p_today: today }, 'số liệu theo kỳ');
    return ps.map((p, i) => ({ p, t: ts[i] }));
  },

  /** = sourceSeries(rows, ps, today) */
  async getSourceSeries(ps: Period[], filters: ReportFilters, today: string): Promise<SourcePeriod[]> {
    if (!ps.length) return [];
    const xs = await rpc<Omit<SourcePeriod, 'p'>[]>('report_sources', { p_periods: span(ps), p_filters: cleanFilters(filters), p_today: today }, 'số liệu theo nguồn');
    return ps.map((p, i) => ({ p, ...xs[i] }));
  },

  async getObTarget(): Promise<number> {
    const { data, error } = await supabase.from('app_settings').select('value').eq('key', 'ob_target').maybeSingle();
    if (error) throw new ApiError('Không tải được Target.', 500, error.code || 'SETTINGS_FAILED');
    return Number(data?.value) || 0;
  },

  /** Chỉ Admin (RLS as_admin_write). */
  async setObTarget(target: number): Promise<number> {
    const v = Math.max(0, Math.round(Number(target) || 0));
    const { error } = await supabase.from('app_settings').upsert({ key: 'ob_target', value: v, sensitive: false });
    if (error) throw new ApiError(error.code === '42501' ? 'Chỉ Admin được đổi Target.' : 'Không lưu được Target.', 403, error.code || 'SETTINGS_FAILED');
    return v;
  },
};
