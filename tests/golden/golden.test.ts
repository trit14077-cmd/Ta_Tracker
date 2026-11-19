// M1-3: đối chiếu logic dùng chung với golden fixture (fixture.json).
// Sinh lại fixture (chỉ khi CỐ Ý đổi quy tắc, phải được duyệt): GEN_GOLDEN=1 npx vitest run tests/golden
import { readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { computeOutputs, makeRecords } from './golden.ts';

const FIXTURE = new URL('./fixture.json', import.meta.url);
const recs = makeRecords();
const outputs = computeOutputs(recs);

describe('golden fixtures (M1-3)', () => {
  it.runIf(process.env.GEN_GOLDEN === '1')('sinh fixture.json', () => {
    writeFileSync(FIXTURE, JSON.stringify({ records: recs, outputs }, null, 1) + '\n');
  });

  it.skipIf(process.env.GEN_GOLDEN === '1')('logic hiện tại ra đúng kết quả đã chốt', () => {
    const fx = JSON.parse(readFileSync(FIXTURE, 'utf8'));
    expect(recs).toEqual(fx.records); // bộ sinh dữ liệu không đổi
    expect(outputs).toEqual(fx.outputs);
  });

  it('bộ dữ liệu phủ đủ các trường hợp', () => {
    const subs = new Set(outputs.perRecord.map((p) => p.sub));
    for (const s of ['lead_new', 'r1_wait', 'su', 'lu', 'r2_passed', 'r2_failed', 'r2_canceled', 'ob_wait', null]) expect(subs).toContain(s);
    const stages = new Set(outputs.perRecord.map((p) => p.stage));
    for (const s of ['New', 'Screening', 'Interview', 'Evaluation', 'Passed', 'Offer', 'Hired', 'Rejected', 'On Hold']) expect(stages).toContain(s);
    expect(outputs.byRange.all.totals.att30).toBeGreaterThan(0);
    expect(outputs.byRange.all.totals.er60d).toBeGreaterThan(0);
  });
});
