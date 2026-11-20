import React, { useEffect, useMemo, useState } from 'react';
import { FileDown, ImagePlus, X } from 'lucide-react';
import logoUrl from '../assets/the-supra-logo.png';
import type { CandidateRecord } from '../services/candidateService.ts';
import { positionEn } from '../../../shared/positionCatalog.ts';
import { CV_LABELS, type CvData, type CvLang, GENDER_EN, cvHtml, yearOf } from '../../../shared/cvTemplate.ts';

const asBullets = (s: string) =>
  String(s || '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => (/^[-•*–]/.test(l) ? l : `- ${l}`))
    .join('\n');

function defaultIntro(c: Record<string, string>, lang: CvLang): string {
  const pos = lang === 'en' ? positionEn(c.position || '') : c.position || '';
  const years = c.experience_years || '';
  if (lang === 'en') return [pos && `Candidate for the position of ${pos}.`, years && `Experience: ${years}.`].filter(Boolean).join(' ').replace(/năm/g, 'years');
  return [pos && `Ứng viên vị trí ${pos}.`, years && `Kinh nghiệm: ${years}.`].filter(Boolean).join(' ');
}

export const CvBuilderModal: React.FC<{ candidate: CandidateRecord; onClose: () => void }> = ({ candidate, onClose }) => {
  const c = candidate as unknown as Record<string, string>;
  const [lang, setLang] = useState<CvLang>('vi');
  const [address, setAddress] = useState(String(c.address || ''));
  const [phone, setPhone] = useState(c.phone ? `0${c.phone}` : '');
  const [email, setEmail] = useState(String(c.email || ''));
  const [birth, setBirth] = useState(yearOf(String(c.birth || '')));
  const [gender, setGender] = useState(String(c.gender || ''));
  const [name, setName] = useState(String(c.full_name || ''));
  const [title, setTitle] = useState(String(c.position || ''));
  const [intro, setIntro] = useState(defaultIntro(c, 'vi'));
  const [experience, setExperience] = useState(asBullets(c.experience_summary));
  const [education, setEducation] = useState(String(c.education_level || ''));
  const [skills, setSkills] = useState('');
  const [languages, setLanguages] = useState('');
  const [photo, setPhoto] = useState('');
  const [photoErr, setPhotoErr] = useState('');

  useEffect(() => {
    setIntro(defaultIntro(c, lang));
    // chức danh theo ngôn ngữ CV: tên tiếng Anh theo danh mục vị trí 18.11
    setTitle(lang === 'en' ? positionEn(String(c.position || '')) : String(c.position || ''));
    setExperience(asBullets(c.experience_summary));
  }, [lang, c]);

  const data: CvData = useMemo(() => {
    const t = CV_LABELS[lang];
    const info: [string, string][] = [
      [t.address, address],
      [t.phone, phone],
      [t.email, email],
      [t.birth, birth],
      [t.gender, lang === 'en' ? GENDER_EN[gender] || gender : gender],
    ];
    return { name, title, intro, experience, education, skills, languages, info, photo, code: String(c.candidate_code || '') };
  }, [lang, name, title, intro, experience, education, skills, languages, address, phone, email, birth, gender, photo, c]);

  const html = useMemo(() => cvHtml(data, lang, logoUrl), [data, lang]);

  const pickPhoto = (f: File | undefined) => {
    setPhotoErr('');
    if (!f) return;
    if (!/^image\/(png|jpeg)$/.test(f.type)) return setPhotoErr('Chỉ nhận ảnh PNG hoặc JPG.');
    if (f.size > 3 * 1024 * 1024) return setPhotoErr('Ảnh tối đa 3 MB.');
    const r = new FileReader();
    r.onload = () => setPhoto(String(r.result || ''));
    r.readAsDataURL(f);
  };

  const exportPdf = () => {
    const frame = document.createElement('iframe');
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
    frame.srcdoc = html;
    frame.onload = () => {
      setTimeout(() => {
        try {
          frame.contentWindow?.focus();
          frame.contentWindow?.print();
        } finally {
          setTimeout(() => frame.remove(), 60_000);
        }
      }, 600);
    };
    document.body.appendChild(frame);
  };

  const input = 'w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded focus:outline-none focus:border-blue-600';
  const area = (label: string, value: string, set: (v: string) => void, rows: number, hint?: string) => (
    <label className="block">
      <span className="text-slate-600">{label}</span>
      <textarea value={value} onChange={(e) => set(e.target.value)} rows={rows} className={input} data-no-i18n />
      {hint && <span className="text-[11px] text-slate-400">{hint}</span>}
    </label>
  );

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/60 p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-lg border border-slate-200 shadow-xl w-full max-w-6xl max-h-[94vh] flex flex-col overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-200 bg-slate-50 flex items-center justify-between gap-3">
          <div className="text-sm font-bold text-slate-900">Tạo CV theo mẫu THE SUPRA</div>
          <button type="button" onClick={onClose} className="p-1.5 text-slate-500 hover:text-slate-900" aria-label="Đóng">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="flex-1 overflow-hidden grid grid-cols-1 md:grid-cols-[340px_1fr]">
          <div className="p-4 space-y-3 overflow-y-auto border-r border-slate-200 text-xs">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-slate-700">Ngôn ngữ CV</span>
              {(['vi', 'en'] as CvLang[]).map((l) => (
                <button key={l} type="button" onClick={() => setLang(l)} className={`px-2.5 py-1 rounded border ${lang === l ? 'bg-blue-600 text-white border-blue-600' : 'border-slate-300 text-slate-700'}`}>
                  {l === 'vi' ? 'Tiếng Việt' : 'English'}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <label className="inline-flex items-center gap-1.5 px-2.5 py-1.5 font-semibold text-blue-700 border border-blue-200 rounded cursor-pointer hover:bg-blue-50">
                <ImagePlus className="w-3.5 h-3.5" /> {photo ? 'Đổi ảnh' : 'Thêm ảnh chân dung'}
                <input type="file" accept="image/png,image/jpeg" className="hidden" onChange={(e) => { pickPhoto(e.target.files?.[0]); e.target.value = ''; }} />
              </label>
              {photo && <button type="button" onClick={() => setPhoto('')} className="text-red-600 underline">Bỏ ảnh</button>}
            </div>
            {photoErr && <p className="text-red-700">{photoErr}</p>}
            <p className="text-[11px] text-slate-500">Không có ảnh thì ô tròn hiện logo THE SUPRA. Ảnh chỉ dùng cho CV này, không lưu lên hệ thống.</p>
            <label className="block">
              <span className="text-slate-600">Họ tên</span>
              <input value={name} onChange={(e) => setName(e.target.value)} className={input} data-no-i18n />
            </label>
            <label className="block">
              <span className="text-slate-600">Dòng dưới tên (vị trí)</span>
              <input value={title} onChange={(e) => setTitle(e.target.value)} className={input} data-no-i18n />
            </label>
            <div className="rounded border border-slate-200 p-2 space-y-2">
              <div className="font-semibold text-slate-700">Thông tin cá nhân (cột trái)</div>
              {(
                [
                  ['Địa chỉ', address, setAddress],
                  ['Điện thoại', phone, setPhone],
                  ['Email', email, setEmail],
                  ['Năm sinh', birth, setBirth],
                  ['Giới tính', gender, setGender],
                ] as [string, string, (v: string) => void][]
              ).map(([label, value, set]) => (
                <label key={label} className="block">
                  <span className="text-slate-600">{label}</span>
                  <input value={value} onChange={(e) => set(e.target.value)} className={input} data-no-i18n />
                </label>
              ))}
              <span className="text-[11px] text-slate-400">Lấy sẵn từ hồ sơ. Xóa trống ô nào thì mục đó không hiện trên CV.</span>
            </div>
            {area('Giới thiệu ngắn', intro, setIntro, 3)}
            {area('Kinh nghiệm làm việc', experience, setExperience, 8, 'Mỗi dòng một ý. Dòng bắt đầu bằng "-" là gạch đầu dòng; dòng khác là tiêu đề (công việc, công ty, thời gian).')}
            {area('Học vấn', education, setEducation, 3, 'Ví dụ: Đại học Kinh tế TP.HCM, Quản trị kinh doanh (2015 - 2019)')}
            {area('Kỹ năng (cột trái)', skills, setSkills, 4, 'Mỗi dòng một kỹ năng. Để trống thì không hiện mục này.')}
            {area('Ngoại ngữ (cột trái)', languages, setLanguages, 2, 'Ví dụ: Tiếng Anh – B1')}
            <p className="text-[11px] text-slate-500">
              Nội dung sửa ở đây chỉ áp dụng cho CV này, không đổi hồ sơ. CV không bao giờ có lương, CCCD, ngân hàng hay bình luận nội bộ.
            </p>
            <button type="button" onClick={exportPdf} className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold text-white bg-blue-600 rounded-md hover:bg-blue-700">
              <FileDown className="w-3.5 h-3.5" /> Xuất PDF
            </button>
            <p className="text-[11px] text-slate-500">Cửa sổ in mở ra: chọn máy in “Lưu dưới dạng PDF” (Save as PDF), bật “Đồ họa nền” (Background graphics) để giữ cột màu xanh, rồi bấm Lưu.</p>
          </div>
          <div className="bg-slate-200 overflow-auto">
            <iframe title="Xem trước CV" srcDoc={html} className="block w-full h-[1180px] border-0" />
          </div>
        </div>
      </div>
    </div>
  );
};
