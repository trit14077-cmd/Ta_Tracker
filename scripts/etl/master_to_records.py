#!/usr/bin/env python3
"""Master.xlsx (sheet 'Master', header 2 tầng) -> recruitment_records (CSV + exceptions + KPI oracle).
Chạy: python master_to_records.py <Master.xlsx> <out_dir>
Không ghi DB. Dữ liệu cá nhân: giữ out_dir ngoài git (đã có trong .gitignore khuyến nghị)."""
import sys, re, json, datetime as dt
import pandas as pd

SRC, OUT = sys.argv[1], sys.argv[2]
raw = pd.read_excel(SRC, sheet_name='Master', header=None, dtype=object)
df = raw.iloc[2:].copy(); df.columns = [str(c).replace('\n', ' ').strip() for c in raw.iloc[1]]
df = df.reset_index(drop=True)

def s(v):
    return '' if v is None or (isinstance(v, float) and pd.isna(v)) or v is pd.NaT else str(v).strip()
def d(v):
    if isinstance(v, (dt.datetime, pd.Timestamp)) and not pd.isna(v): return v.date().isoformat()
    return None
def num(v):
    try: return None if v is None or pd.isna(v) else float(v)
    except Exception: return None
def tm(v):
    if isinstance(v, float) and not pd.isna(v) and 0 <= v < 1:
        m = round(v * 1440); return f'{m//60:02d}:{m%60:02d}'
    return ''
def phone(v):
    p = re.sub(r'\D', '', s(v))
    if p.startswith('84') and len(p) in (11, 12): p = '0' + p[2:]
    if len(p) == 9: p = '0' + p
    return p

exc = []
def ex(i, kind, detail=''): exc.append({'row_excel': i + 4, 'kind': kind, 'detail': detail})

# mã trùng / thiếu -> cấp mã mới cho dòng đến sau (phương án B)
codes = [s(x) for x in df['No.']]
seen, maxn = set(), {}
for c in codes:
    m = re.match(r'^([A-Za-z]+)(\d+)$', c)
    if m: maxn[m.group(1)] = max(maxn.get(m.group(1), 0), int(m.group(2)))
rows = []
for i, r in df.iterrows():
    code, legacy = codes[i], ''
    if not re.match(r'^[A-Za-z]+\d+$', code):
        ex(i, 'MA_SAI_DINH_DANG' if code else 'THIEU_MA', code)
        legacy = code; code = ''
    if code and code in seen:
        legacy = code; code = ''; ex(i, 'MA_TRUNG', legacy)
    if not code:
        pre = 'IT'; maxn[pre] = maxn.get(pre, 0) + 1; code = f'{pre}{maxn[pre]:05d}'
    seen.add(code)
    ph = phone(r['Phone'])
    if not ph: ex(i, 'THIEU_SDT')
    elif len(ph) != 10: ex(i, 'SDT_SAI_DO_DAI', ph)
    if not s(r['Region']): ex(i, 'THIEU_REGION')
    note = s(r['R1_Note'])
    if s(r['R1']): note = (note + ' | ' if note else '') + s(r['R1']); ex(i, 'GHI_CHU_CAT_O_COT_R1', s(r['R1']))
    rows.append(dict(
        candidate_code=code, legacy_code=legacy, pic=s(r['PIC']) or None,
        created_at=d(r['Timestamp']), full_name=s(r['Name']), phone=ph, email=s(r['Email']),
        position=s(r['Position']), rank=s(r['Rank']), region=s(r['Region']), location=s(r['Location']),
        unit=s(r['Unit']), dept=s(r['Dept']), site=s(r['Site']), source=s(r['Source']), sub_source=s(r['Sub_Source']),
        r1_date=d(r['R1_Date']), r1_time=tm(r['R1_Time']), r1_status=s(r['R1_STT']), r1_sub_status=s(r['R1_Sub_STT']),
        r1_note=note, r1_cdd_fb=s(r['R1_CDD_FB']),
        r2_date=d(r['R2_Date']), r2_time=tm(r['R2_Time']), r2_status=s(r['R2_STT']), r2_sub_status=s(r['R2_Sub_STT']),
        r2_note=s(r['R2_Note']), r2_cdd_fb=s(r['R2_CDD_FB']),
        ob_date=d(r['OBD']), ob_status=s(r['OB Status']), ob_sub_status=s(r['OB_Sub_STT']), ob_note=s(r['OB_Note']), ob_month=s(r['OB_Month']),
        basic_salary=num(r['Basic']), meal_allowance=num(r['Meal']), fmcg_allowance=num(r['FMCG']),
        attraction_allowance=num(r['Attraction']), nightshift_allowance=num(r['Nightshift']), probation_pct=num(r['% Probation']),
        probation_period=s(r['Probation Period']).replace('.0', ''), contract_signed_date=d(r['Employment Contract Signed Date']),
        emp_id=s(r['Emp_ID']), doc_099_250=s(r['099/250']), dept_confirm=s(r['Dept. Confirm']), ob_mail=s(r['OB Mail']),
        probation_contract=s(r['Probation Contract']), drive_upload=s(r['Drive upload']), edu_certificate=s(r['Education Certificate']),
        health_check=s(r['Health check']), id_card=s(r['ID Card']), resume=s(r['Resume']), doc_note=s(r['Note Document']),
        emp_status=s(r['Emp_STT']), attrition_date=d(r['Attrition_Date']), attrition_reason=s(r['Attrition_Reason']),
        attrition_sub_reason=s(r['Attrition_Sub Reason']), attrition_note=s(r['Attrition Note']),
        cutoff=s(r['Cut-off']), cutoff_mail=s(r['Cut-off Mail']),
    ))
out = pd.DataFrame(rows)
out.to_csv(f'{OUT}/records.csv', index=False, encoding='utf-8')
pd.DataFrame(exc).to_csv(f'{OUT}/exceptions.csv', index=False, encoding='utf-8')
cnt = lambda c, v: int((out[c] == v).sum())
kpi = {'total': len(out), 'r1_passed': cnt('r1_status', 'Passed'), 'r1_failed': cnt('r1_status', 'Failed'),
       'r2_passed': cnt('r2_status', 'Passed'), 'ob_joined': cnt('ob_status', 'Joined'),
       'emp_active': cnt('emp_status', 'Active'), 'emp_resigned': cnt('emp_status', 'Resigned'),
       'distinct_pic': int(out['pic'].nunique()), 'exceptions': pd.DataFrame(exc).groupby('kind').size().to_dict()}
json.dump(kpi, open(f'{OUT}/oracle_kpi.json', 'w'), ensure_ascii=False, indent=1)
print(json.dumps(kpi, ensure_ascii=False, indent=1))
