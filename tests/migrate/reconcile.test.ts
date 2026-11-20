import { describe, expect, it } from 'vitest';
import {
  computeBoardCounts,
  computeColumnHash,
  computeDistribution,
  compareDistributions,
  computeKpiTotals,
} from '../../scripts/migrate/reconcile.ts';

describe('M8-3: Reconcile logic tests', () => {
  const sampleRecords = [
    {
      candidate_code: 'UV001',
      pic: 'TA1',
      r1_status: 'Passed',
      r2_status: 'Passed',
      ob_status: 'Joined',
      emp_status: 'Active',
      is_archived: false,
    },
    {
      candidate_code: 'UV002',
      pic: 'TA1',
      r1_status: 'Passed',
      r2_status: 'Failed',
      ob_status: '',
      emp_status: '',
      is_archived: false,
    },
    {
      candidate_code: 'UV003',
      pic: 'TA2',
      r1_status: 'Failed',
      r2_status: '',
      ob_status: '',
      emp_status: '',
      is_archived: false,
    },
    {
      candidate_code: 'UV004',
      pic: 'TA2',
      r1_status: '',
      r2_status: '',
      ob_status: '',
      emp_status: '',
      is_archived: false,
    },
    {
      candidate_code: 'UV005',
      pic: 'TA1',
      r1_status: 'Passed',
      r2_status: 'Passed',
      ob_status: 'Joined',
      emp_status: 'Resigned',
      is_archived: false,
    },
    {
      candidate_code: 'UV006_ARCHIVED',
      pic: 'TA1',
      r1_status: 'Passed',
      r2_status: 'Passed',
      ob_status: 'Joined',
      emp_status: 'Active',
      is_archived: true, // Không được tính vào KPI
    },
  ];

  it('computeKpiTotals tính đúng và bỏ qua is_archived', () => {
    const kpi = computeKpiTotals(sampleRecords);
    expect(kpi.leads).toBe(5);
    expect(kpi.r1_passed).toBe(3);
    expect(kpi.r2_passed).toBe(2);
    expect(kpi.ob_joined).toBe(2);
    expect(kpi.emp_active).toBe(1);
    expect(kpi.emp_resigned).toBe(1);
  });

  it('computeDistribution & compareDistributions đếm và so sánh phân bổ chính xác', () => {
    const distSource = computeDistribution(sampleRecords, 'pic');
    expect(distSource['TA1']).toBe(4);
    expect(distSource['TA2']).toBe(2);

    const distTargetMatching = { TA1: 4, TA2: 2 };
    const resMatch = compareDistributions(distSource, distTargetMatching);
    expect(resMatch.match).toBe(true);
    expect(Object.keys(resMatch.diffs).length).toBe(0);

    const distTargetDiff = { TA1: 3, TA2: 3 };
    const resDiff = compareDistributions(distSource, distTargetDiff);
    expect(resDiff.match).toBe(false);
    expect(resDiff.diffs['TA1']).toEqual({ source: 4, target: 3, diff: -1 });
    expect(resDiff.diffs['TA2']).toEqual({ source: 2, target: 3, diff: 1 });
  });

  it('computeColumnHash ổn định theo candidate_code (idempotent)', () => {
    const hash1 = computeColumnHash(sampleRecords, 'pic');
    // Đảo ngược mảng
    const reversed = [...sampleRecords].reverse();
    const hash2 = computeColumnHash(reversed, 'pic');
    expect(hash1).toBe(hash2);

    // Thay đổi 1 giá trị -> hash khác
    const modified = sampleRecords.map((r) =>
      r.candidate_code === 'UV001' ? { ...r, pic: 'TA_DIFF' } : r
    );
    const hash3 = computeColumnHash(modified, 'pic');
    expect(hash3).not.toBe(hash1);
  });

  it('computeBoardCounts tính đúng các cột Kanban và trạng thái phụ', () => {
    const board = computeBoardCounts(sampleRecords);
    // UV001: ob Joined -> ob
    // UV002: r2 Failed -> r2 (failed: true, sub: r2_failed)
    // UV003: r1 Failed -> r1 (failed: true, sub: null)
    // UV004: không r1 -> lead (sub: lead_new)
    // UV005: ob Joined -> ob
    // UV006: is_archived -> bỏ qua
    expect(board.counts.lead.total).toBe(1);
    expect(board.counts.r1.total).toBe(1);
    expect(board.counts.r1.failed).toBe(1);
    expect(board.counts.r2.total).toBe(1);
    expect(board.counts.r2.failed).toBe(1);
    expect(board.counts.ob.total).toBe(2);
    expect(board.counts.ob.failed).toBe(0);

    expect(board.subs.lead_new).toBe(1);
    expect(board.subs.r2_failed).toBe(1);
  });
});
