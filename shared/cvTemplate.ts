/**
 * THE SUPRA CV page, laid out like the company template "CV-EN-1.docx": A4, a navy (#002060) column on the left with
 * the photo, personal information, skills and languages in white; the name, introduction, professional experience
 * and education on the right; Montserrat font. One self-contained HTML document (inline styles, images passed in),
 * used for the preview and the PDF. Pure function, no browser API.
 */
export type CvLang = 'vi' | 'en';

export const CV_LABELS: Record<CvLang, Record<string, string>> = {
  vi: {
    personal: 'Thông tin cá nhân', experience: 'Kinh nghiệm làm việc', education: 'Học vấn', skills: 'Kỹ năng', languages: 'Ngoại ngữ',
    code: 'Mã ứng viên', address: 'Địa chỉ', gender: 'Giới tính', birth: 'Năm sinh', phone: 'Điện thoại', email: 'Email',
    footer: 'Tài liệu nội bộ THE SUPRA. Không chia sẻ ra bên ngoài.',
  },
  en: {
    personal: 'Personal information', experience: 'Professional experience', education: 'Education', skills: 'Skills', languages: 'Languages',
    code: 'Candidate code', address: 'Address', gender: 'Gender', birth: 'Year of birth', phone: 'Phone number', email: 'Email',
    footer: 'THE SUPRA internal document. Do not share outside the company.',
  },
};
export const GENDER_EN: Record<string, string> = { Nam: 'Male', Nữ: 'Female' };

const esc = (s: string) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export const yearOf = (birth: string) => (/(\d{4})\s*$/.exec(birth || '') || [])[1] || birth || '';

export interface CvData {
  name: string;
  /** Line under the name (the applied position). */
  title: string;
  /** Short introduction paragraph under the name. */
  intro: string;
  /** One idea per line; a line starting with "-", "•" or "*" is a bullet, any other line a heading (job, company, dates). */
  experience: string;
  /** Same rule as experience. */
  education: string;
  /** One per line. */
  skills: string;
  languages: string;
  /** Shown small in the footer. */
  code: string;
  /** Left column, Personal information: label / value pairs (empty values are left out). */
  info: [string, string][];
  /** Data URL of a photo, or '' to show the company logo instead. */
  photo: string;
}

const lines = (s: string) => String(s || '').split('\n').map((l) => l.trim()).filter(Boolean);

/** Headings and bullet points from free text (one idea per line). */
function blocks(s: string): string {
  let html = '';
  let inList = false;
  for (const l of lines(s)) {
    const bullet = /^[-•*–]\s*/.exec(l);
    if (bullet) {
      if (!inList) { html += '<ul>'; inList = true; }
      html += `<li>${esc(l.slice(bullet[0].length))}</li>`;
    } else {
      if (inList) { html += '</ul>'; inList = false; }
      html += `<p class="h">${esc(l)}</p>`;
    }
  }
  if (inList) html += '</ul>';
  return html;
}

export function cvHtml(d: CvData, lang: CvLang, logoSrc: string): string {
  const t = CV_LABELS[lang];
  const info = d.info.filter(([, v]) => v).map(([k, v]) => `<div class="k">${esc(k)}</div><div class="v">${esc(v)}</div>`).join('');
  const list = (title: string, s: string) => (lines(s).length ? `<h3>${esc(title)}</h3>${lines(s).map((x) => `<div class="v">${esc(x.replace(/^[-•*–]\s*/, ''))}</div>`).join('')}` : '');
  const pic = d.photo
    ? `<div class="photo"><img src="${esc(d.photo)}" alt=""></div>`
    : `<div class="photo logo"><img src="${esc(logoSrc)}" alt="THE SUPRA"></div>`;
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><title>${esc(d.name)} - THE SUPRA</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;600;700&display=swap">
<style>
@page { size: A4; margin: 0; }
* { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
html, body { margin: 0; }
body { font-family: Montserrat, Arial, Helvetica, sans-serif; color: #1f2937; font-size: 10.5px; line-height: 1.5; }
.page { width: 210mm; min-height: 297mm; display: grid; grid-template-columns: 64mm 1fr; margin: 0 auto; background: #fff; }
.side { background: #002060; color: #fff; padding: 12mm 7mm; }
.photo { width: 50mm; height: 50mm; border-radius: 50%; overflow: hidden; margin: 0 auto 8mm; border: 3px solid #fff; background: #fff; }
.photo img { width: 100%; height: 100%; object-fit: cover; }
.photo.logo img { object-fit: contain; padding: 7mm; }
.side h3 { font-size: 11px; text-transform: uppercase; letter-spacing: 1px; border-bottom: 1px solid rgba(255,255,255,.5); padding-bottom: 3px; margin: 7mm 0 3mm; }
.side .k { font-weight: 700; margin-top: 2mm; }
.side .v { color: #e5e7eb; word-break: break-word; }
.main { padding: 14mm 11mm 12mm; display: flex; flex-direction: column; }
h1 { font-size: 26px; line-height: 1.15; color: #002060; margin: 0; font-weight: 700; }
.title { font-size: 13px; font-weight: 600; color: #374151; margin: 2mm 0 5mm; }
.intro { margin: 0 0 4mm; text-align: justify; }
.main h2 { font-size: 13px; color: #002060; text-transform: uppercase; letter-spacing: 1px; border-bottom: 2px solid #002060; padding-bottom: 2px; margin: 6mm 0 3mm; }
.main p.h { font-weight: 700; margin: 3mm 0 1mm; }
.main ul { margin: 0 0 2mm; padding-left: 5mm; }
.main li { margin: .5mm 0; }
.foot { margin-top: auto; padding-top: 8mm; display: flex; align-items: center; gap: 3mm; font-size: 8.5px; color: #9ca3af; }
.foot img { height: 9mm; }
@media screen { body { background: #e5e7eb; padding: 6mm 0; } .page { box-shadow: 0 1px 6px rgba(0,0,0,.2); } }
</style></head><body><div class="page">
<aside class="side">${pic}
<h3>${esc(t.personal)}</h3>${info}
${list(t.skills, d.skills)}
${list(t.languages, d.languages)}
</aside>
<main class="main">
<h1>${esc(d.name)}</h1>
${d.title.trim() ? `<div class="title">${esc(d.title)}</div>` : ''}
${d.intro.trim() ? `<p class="intro">${esc(d.intro).replace(/\n/g, '<br>')}</p>` : ''}
${lines(d.experience).length ? `<h2>${esc(t.experience)}</h2>${blocks(d.experience)}` : ''}
${lines(d.education).length ? `<h2>${esc(t.education)}</h2>${blocks(d.education)}` : ''}
<div class="foot"><img src="${esc(logoSrc)}" alt="THE SUPRA"><span>${d.code ? esc(t.code) + ": " + esc(d.code) + " · " : ""}${esc(t.footer)}</span></div>
</main></div></body></html>`;
}
