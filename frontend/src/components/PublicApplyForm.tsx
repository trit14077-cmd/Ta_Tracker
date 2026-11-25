import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  BadgeCheck,
  CircleCheck,
  FileText,
  Handshake,
  LoaderCircle,
  MapPin,
  MessagesSquare,
  PhoneCall,
  ShieldCheck,
  Send,
  Upload,
  Wallet,
  X,
  ChevronDown,
} from 'lucide-react';
import { ApiError } from '../services/candidateService.ts';
import { applicationsService as dataService, type ApplicationForm } from '../services/applicationsService.ts';
import logoUrl from '../assets/the-supra-logo.png';

// Chép nguyên từ OLD/src/components/PublicApplyForm.tsx (M7-3). Gửi qua Edge `apply` (multipart, không base64).
/**
 * Public careers page with the application form ("Ứng tuyển chung"), opened from <web app>?apply=<code> without login.
 * One action: send the application. What the candidate sends goes to the inbox of the TA whose link it is
 * (apps-script/Apply.gs). Everything shown comes from the system (steps of the process, regions of the drop-lists);
 * no invented numbers or testimonials.
 */

const MAX_BYTES = 5 * 1024 * 1024;
const EXT = ['pdf', 'doc', 'docx', 'jpg', 'jpeg', 'png'];
type Errors = Partial<Record<'full_name' | 'phone' | 'email' | 'area' | 'position' | 'note' | 'consent' | 'cv', string>>;
type Region = { region: string; locations: string[] };

const NAVY = '#0A2347';

/**
 * Photos over 700 KB become a JPEG of at most 1800 px on the long side (quality 0.82): still easy to read, usually
 * 300-600 KB. Anything that cannot be read as an image (or does not get smaller) is kept as it is.
 */
async function shrinkImage(file: File): Promise<File> {
  if (file.size <= 700 * 1024 || typeof createImageBitmap !== 'function') return file;
  try {
    const img = await createImageBitmap(file);
    const scale = Math.min(1, 1800 / Math.max(img.width, img.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.fillStyle = '#fff'; // transparent PNG areas become white, not black
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    img.close();
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.82));
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.(png|jpe?g)$/i, '') + '.jpg', { type: 'image/jpeg' });
  } catch {
    return file;
  }
}

const STEPS = [
  { icon: Send, title: 'Gửi thông tin', text: 'Điền form bên trên trong khoảng 2 phút. CV có thể gửi kèm hoặc bổ sung sau.' },
  { icon: PhoneCall, title: 'Trao đổi qua điện thoại', text: 'Chuyên viên tuyển dụng gọi cho bạn để tìm hiểu nhu cầu, khu vực và ca làm mong muốn.' },
  { icon: MessagesSquare, title: 'Phỏng vấn', text: 'Bạn gặp trực tiếp quản lý bộ phận để trao đổi về công việc và môi trường làm việc.' },
  { icon: Handshake, title: 'Nhận việc', text: 'Hoàn tất giấy tờ, nhận lịch đi làm và được hướng dẫn trong những ngày đầu.' },
];

const FAQ = [
  { q: 'Tôi chưa có CV thì có ứng tuyển được không?', a: 'Được. CV không bắt buộc. Bạn chỉ cần để lại họ tên và số điện thoại; nếu cần, chuyên viên tuyển dụng sẽ hướng dẫn bạn bổ sung sau.' },
  { q: 'Ứng tuyển có mất phí không?', a: 'Không. THE SUPRA không thu bất kỳ khoản phí nào trong suốt quá trình tuyển dụng. Nếu có ai yêu cầu bạn nộp tiền để được nhận việc, hãy từ chối và báo cho chúng tôi.' },
  { q: 'Khi nào tôi được liên hệ?', a: 'Hồ sơ được chuyển ngay đến bộ phận tuyển dụng. Chúng tôi sẽ gọi cho bạn qua số điện thoại đã đăng ký khi có vị trí phù hợp với khu vực bạn mong muốn.' },
  { q: 'Thông tin của tôi được dùng vào việc gì?', a: 'Chỉ dùng cho mục đích tuyển dụng của THE SUPRA và chỉ bộ phận tuyển dụng được xem. Chúng tôi không chia sẻ thông tin của bạn cho bên ngoài.' },
  { q: 'Tôi muốn làm ở khu vực khác thì sao?', a: 'Bạn ghi rõ tỉnh / thành phố mong muốn ở ô "Khu vực mong muốn làm việc". Bạn có thể ghi nhiều nơi trong phần Giới thiệu ngắn.' },
  { q: 'Tôi gửi nhầm thông tin thì làm thế nào?', a: 'Bạn có thể gửi lại form sau ít phút với thông tin đúng, hoặc báo lại khi chuyên viên tuyển dụng gọi cho bạn.' },
];

export const PublicApplyForm: React.FC<{ code: string }> = ({ code }) => {
  const [linkState, setLinkState] = useState<'checking' | 'ok' | 'bad'>('checking');
  const [linkError, setLinkError] = useState('');
  const [regions, setRegions] = useState<Region[]>([]);
  const [positions, setPositions] = useState<string[]>([]);
  useEffect(() => {
    dataService.checkApplyLink(code).then(
      (r) => {
        setRegions(r.regions);
        setPositions(r.positions);
        setLinkState('ok');
      },
      (e) => {
        // Chỉ link sai thật (404 BAD_LINK) mới thay form bằng thông báo; lỗi mạng thì vẫn cho điền (khi gửi trang tự thử lại).
        if (e instanceof ApiError && e.status === 404) {
          setLinkState('bad');
          setLinkError(e.message);
        } else setLinkState('ok');
      }
    );
  }, [code]);

  const [form, setForm] = useState<ApplicationForm>({ full_name: '', phone: '', email: '', area: '', position: '', note: '', consent: false, website: '' });
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [sending, setSending] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [sendError, setSendError] = useState('');
  const [done, setDone] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLElement>(null);

  const goToForm = () => {
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    formRef.current?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
    window.setTimeout(() => document.getElementById('ap-name')?.focus({ preventScroll: true }), reduce ? 0 : 500);
  };

  const set = (k: keyof ApplicationForm, v: string | boolean) => {
    setForm((f) => ({ ...f, [k]: v }));
    setErrors((e) => ({ ...e, [k]: undefined }));
  };

  const pickFile = async (picked: File | null | undefined) => {
    if (!picked) return;
    const ext = (picked.name.split('.').pop() || '').toLowerCase();
    if (!EXT.includes(ext)) return setErrors((e) => ({ ...e, cv: 'Chỉ nhận file PDF, DOC, DOCX, JPG, PNG.' }));
    // A photo of a CV taken on a phone is often 3-5 MB: shrink it here, so it uploads in a moment on 4G.
    const f = ['jpg', 'jpeg', 'png'].includes(ext) ? await shrinkImage(picked) : picked;
    if (f.size > MAX_BYTES) return setErrors((e) => ({ ...e, cv: 'File CV tối đa 5 MB.' }));
    setErrors((e) => ({ ...e, cv: undefined }));
    setFile(f);
  };

  const validate = (): Errors => {
    const e: Errors = {};
    if (!form.full_name.trim()) e.full_name = 'Vui lòng nhập họ và tên.';
    const digits = form.phone.replace(/\D/g, '');
    if (!form.phone.trim()) e.phone = 'Vui lòng nhập số điện thoại.';
    else if (digits.length < 9 || digits.length > 12) e.phone = 'Số điện thoại chưa đúng (VD: 0912345678).';
    if (form.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) e.email = 'Email chưa đúng định dạng.';
    if (!form.position || !positions.includes(form.position)) e.position = 'Vui lòng chọn vị trí ứng tuyển.';
    if (!form.consent) e.consent = 'Vui lòng đồng ý để chúng tôi lưu và sử dụng thông tin.';
    return e;
  };

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    setSendError('');
    const e = validate();
    setErrors(e);
    if (Object.keys(e).length) {
      const first = (['full_name', 'phone', 'email', 'consent'] as const).find((k) => e[k]);
      if (first) document.getElementById(first === 'consent' ? 'ap-consent' : `ap-${first === 'full_name' ? 'name' : first}`)?.focus();
      return;
    }
    setSending(true);
    try {
      const cv = file;
      // Many people at once: Google runs at most ~30 at the same moment and answers the others "busy" (503 / an HTML
      // error page / a dropped call). Try again up to 5 times, waiting longer each time (about 30 s in all, with a
      // random part so people do not all come back at the same second). Safe: a repeat of a submission that was in
      // fact saved is recognised by its phone and not stored twice.
      for (let attempt = 0; ; attempt++) {
        try {
          await dataService.submitApplication(code, { ...form, cv });
          break;
        } catch (err) {
          const retryable = err instanceof ApiError && (err.status === 0 || err.status === 503);
          if (!retryable || attempt >= 5) throw err;
          setRetrying(true);
          await new Promise((r) => setTimeout(r, 2000 * (attempt + 1) + Math.random() * 2000));
        }
      }
      setDone(true);
      formRef.current?.scrollIntoView({ block: 'start' });
    } catch (err) {
      if (err instanceof ApiError && err.fields) setErrors(err.fields as Errors);
      setSendError(err instanceof Error ? err.message : 'Chưa gửi được hồ sơ. Vui lòng thử lại.');
    } finally {
      setSending(false);
      setRetrying(false);
    }
  };

  const input = 'w-full px-3.5 py-3 text-[15px] text-slate-900 border rounded-lg bg-white placeholder:text-slate-400 focus:outline-none focus:ring-4 focus:ring-blue-100 focus:border-[#0B4A9E] transition-colors';
  const border = (k: keyof Errors) => (errors[k] ? 'border-red-400' : 'border-slate-300');
  const label = 'block text-[13px] font-semibold text-slate-700 mb-1.5';
  const err = (k: keyof Errors) => (errors[k] ? <p className="mt-1.5 text-xs text-red-600">{errors[k]}</p> : null);
  const allLocations = regions.flatMap((r) => r.locations);
  const year = new Date().getFullYear();

  // ---------------------------------------------------------------- the form card
  const card = (
    <section
      ref={formRef}
      id="ung-tuyen"
      aria-labelledby="ap-form-title"
      className="scroll-mt-20 rounded-2xl bg-white text-slate-900 shadow-[0_24px_60px_-12px_rgba(2,12,40,0.45)] ring-1 ring-black/5"
    >
      {/* The form shows at once; the link is checked in the background and only a bad link replaces it. */}
      {linkState === 'bad' ? (
        <div className="px-6 py-16 text-center">
          <p className="text-base font-bold text-slate-900">Link ứng tuyển không còn hiệu lực</p>
          <p className="mt-2 text-sm text-slate-600">{linkError}</p>
        </div>
      ) : done ? (
        <div className="px-6 sm:px-10 py-14 text-center" role="status">
          <div className="mx-auto w-14 h-14 rounded-full bg-emerald-50 flex items-center justify-center">
            <CircleCheck className="w-8 h-8 text-emerald-600" />
          </div>
          <h2 id="ap-form-title" className="mt-5 text-2xl font-extrabold tracking-tight text-slate-900">Đã gửi hồ sơ thành công</h2>
          <p className="mt-3 text-[15px] leading-relaxed text-slate-600 max-w-sm mx-auto">
            Cảm ơn <strong className="text-slate-900">{form.full_name.trim()}</strong> đã quan tâm đến THE SUPRA. Chuyên viên tuyển dụng sẽ gọi cho bạn qua số{' '}
            <strong className="text-slate-900 whitespace-nowrap">{form.phone.trim()}</strong> khi có vị trí phù hợp.
          </p>
          <p className="mt-6 text-xs text-slate-500">THE SUPRA không thu bất kỳ khoản phí tuyển dụng nào.</p>
        </div>
      ) : (
        <>
          <div className="px-6 sm:px-8 pt-7 pb-5 border-b border-slate-100">
            <h2 id="ap-form-title" className="text-xl font-extrabold tracking-tight text-slate-900">Thông tin ứng tuyển</h2>
            <p className="mt-1 text-sm text-slate-500">Các mục có dấu <span className="text-red-600">*</span> là bắt buộc.</p>
          </div>
          <form onSubmit={submit} noValidate className="px-6 sm:px-8 py-6 space-y-5">
            <div className="grid gap-5 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label htmlFor="ap-position" className={label}>Vị trí ứng tuyển <span className="text-red-600">*</span></label>
                <select id="ap-position" value={form.position} onChange={(e) => set('position', e.target.value)} className={`${input} ${border('position')}`} aria-invalid={Boolean(errors.position)}>
                  <option value="">-- Chọn vị trí --</option>
                  {positions.map((p) => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
                {err('position')}
              </div>
              <div>
                <label htmlFor="ap-name" className={label}>Họ và tên <span className="text-red-600">*</span></label>
                <input id="ap-name" autoComplete="name" value={form.full_name} onChange={(e) => set('full_name', e.target.value)} placeholder="Nguyễn Văn A" className={`${input} ${border('full_name')}`} maxLength={100} aria-invalid={Boolean(errors.full_name)} />
                {err('full_name')}
              </div>
              <div>
                <label htmlFor="ap-phone" className={label}>Số điện thoại <span className="text-red-600">*</span></label>
                <input id="ap-phone" type="tel" inputMode="tel" autoComplete="tel" value={form.phone} onChange={(e) => set('phone', e.target.value)} placeholder="0912 345 678" className={`${input} ${border('phone')}`} maxLength={20} aria-invalid={Boolean(errors.phone)} />
                {err('phone')}
              </div>
              <div>
                <label htmlFor="ap-email" className={label}>Email</label>
                <input id="ap-email" type="email" autoComplete="email" value={form.email} onChange={(e) => set('email', e.target.value)} placeholder="ten@gmail.com" className={`${input} ${border('email')}`} maxLength={120} aria-invalid={Boolean(errors.email)} />
                {err('email')}
              </div>
              <div>
                <label htmlFor="ap-area" className={label}>Khu vực mong muốn làm việc</label>
                <input id="ap-area" list="ap-areas" value={form.area} onChange={(e) => set('area', e.target.value)} placeholder="VD: Bình Dương" className={`${input} ${border('area')}`} maxLength={100} />
                <datalist id="ap-areas">
                  {allLocations.map((l) => (
                    <option key={l} value={l} />
                  ))}
                </datalist>
                {err('area')}
              </div>
            </div>

            <div>
              <span className={label}>CV <span className="font-normal text-slate-500">(không bắt buộc · PDF, DOC, DOCX, JPG, PNG · tối đa 5 MB)</span></span>
              {file ? (
                <div className="flex items-center gap-3 px-4 py-3 rounded-lg border border-slate-200 bg-slate-50">
                  <FileText className="w-5 h-5 text-[#0B4A9E] shrink-0" />
                  <span className="flex-1 min-w-0 truncate text-sm font-medium text-slate-800">{file.name}</span>
                  <span className="text-xs text-slate-500 shrink-0">{(file.size / 1024 / 1024).toFixed(1)} MB</span>
                  <button type="button" onClick={() => setFile(null)} aria-label="Bỏ file CV" className="p-1 text-slate-500 hover:text-slate-900 rounded">
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragOver(true);
                  }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragOver(false);
                    pickFile(e.dataTransfer.files?.[0]);
                  }}
                  className={`w-full flex flex-col items-center justify-center gap-1 px-6 py-5 rounded-lg border-2 border-dashed text-sm transition-colors ${
                    dragOver ? 'border-[#0B4A9E] bg-blue-50' : errors.cv ? 'border-red-300 bg-red-50/40' : 'border-slate-300 bg-slate-50 hover:border-[#0B4A9E] hover:bg-blue-50/40'
                  }`}
                >
                  <Upload className="w-5 h-5 text-[#0B4A9E]" />
                  <span className="text-slate-700"><span className="font-semibold text-[#0B4A9E]">Chọn file</span> hoặc kéo thả vào đây</span>
                </button>
              )}
              <input ref={fileRef} type="file" accept=".pdf,.doc,.docx,.jpg,.jpeg,.png" className="hidden" onChange={(e) => { pickFile(e.target.files?.[0]); e.target.value = ''; }} />
              {err('cv')}
            </div>

            <div>
              <label htmlFor="ap-note" className={label}>Giới thiệu ngắn / Ghi chú</label>
              <textarea id="ap-note" rows={3} value={form.note} onChange={(e) => set('note', e.target.value)} placeholder="Kinh nghiệm, vị trí hoặc ca làm bạn quan tâm..." className={`${input} ${border('note')} resize-y`} maxLength={1000} />
              {err('note')}
            </div>

            {/* Honeypot: hidden from people, bots fill it in. */}
            <div aria-hidden="true" className="absolute -left-[9999px] w-px h-px overflow-hidden">
              <label>
                Website <input tabIndex={-1} autoComplete="off" value={form.website} onChange={(e) => set('website', e.target.value)} />
              </label>
            </div>

            <div>
              <label className="flex items-start gap-3 text-sm leading-relaxed text-slate-700 cursor-pointer">
                <input id="ap-consent" type="checkbox" checked={form.consent} onChange={(e) => set('consent', e.target.checked)} className="mt-0.5 w-[18px] h-[18px] rounded border-slate-300 accent-[#0B4A9E] shrink-0" />
                <span>Tôi đồng ý để THE SUPRA lưu trữ và sử dụng thông tin này cho mục đích tuyển dụng. <span className="text-red-600">*</span></span>
              </label>
              {err('consent')}
            </div>

            {sendError && <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-4 py-2.5">{sendError}</p>}

            <button
              type="submit"
              disabled={sending}
              className="w-full inline-flex items-center justify-center gap-2 py-3.5 rounded-lg bg-[#0B4A9E] hover:bg-[#083B80] active:bg-[#072f66] text-white text-base font-bold shadow-sm transition-colors disabled:opacity-70 focus:outline-none focus-visible:ring-4 focus-visible:ring-blue-200"
            >
              {sending ? <LoaderCircle className="w-4 h-4 animate-spin" /> : null}
              {sending ? (retrying ? 'Đang đông người gửi, đang thử lại...' : 'Đang gửi hồ sơ...') : 'Gửi hồ sơ ứng tuyển'}
              {!sending && <ArrowRight className="w-4 h-4" />}
            </button>
            <p className="flex items-center justify-center gap-1.5 text-xs text-slate-500">
              <ShieldCheck className="w-3.5 h-3.5" /> Thông tin chỉ dùng cho tuyển dụng, không chia sẻ ra bên ngoài.
            </p>
          </form>
        </>
      )}
    </section>
  );

  // ---------------------------------------------------------------- page
  return (
    <div className="min-h-screen bg-white text-slate-900 antialiased">
      {/* Top bar */}
      <header className="sticky top-0 z-30 bg-white border-b border-slate-200">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <img src={logoUrl} alt="THE SUPRA" className="h-11 w-auto" />
            <span className="hidden sm:block h-6 w-px bg-slate-200" />
            <span className="hidden sm:block text-sm font-semibold text-slate-600">Tuyển dụng</span>
          </div>
          {linkState !== 'bad' && !done && (
            <button type="button" onClick={goToForm} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#0B4A9E] hover:bg-[#083B80] text-white text-sm font-semibold transition-colors">
              Ứng tuyển ngay
            </button>
          )}
        </div>
      </header>

      {/* Hero: message on the left, the form on the right (first on the screen on desktop) */}
      <div className="relative overflow-hidden text-white" style={{ backgroundColor: NAVY }}>
        <div
          aria-hidden="true"
          className="absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage: 'linear-gradient(rgba(255,255,255,0.6) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.6) 1px, transparent 1px)',
            backgroundSize: '56px 56px',
          }}
        />
        <div aria-hidden="true" className="absolute -top-40 -right-40 w-[520px] h-[520px] rounded-full bg-[#1D5FC2] opacity-30 blur-3xl" />
        <div className="relative max-w-6xl mx-auto px-4 sm:px-6 pt-12 pb-14 lg:pt-20 lg:pb-24 grid gap-10 lg:grid-cols-[1fr_minmax(0,500px)] lg:gap-14 items-start">
          <div className="lg:pt-6">
            <p className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 ring-1 ring-white/15 text-xs font-semibold tracking-wide text-blue-100">
              <BadgeCheck className="w-3.5 h-3.5" /> Ứng tuyển chung
            </p>
            <h1 className="mt-5 font-display text-4xl sm:text-5xl lg:text-[3.4rem] font-extrabold tracking-tight leading-[1.08]">
              Gia nhập đội ngũ <span className="text-[#8FB8FF] whitespace-nowrap">THE SUPRA</span>
            </h1>
            <p className="mt-5 text-base sm:text-lg leading-relaxed text-blue-100/90 max-w-xl">
              Chưa thấy vị trí phù hợp? Để lại thông tin trong khoảng 2 phút. Bộ phận tuyển dụng sẽ liên hệ khi có cơ hội phù hợp tại khu vực bạn mong muốn.
            </p>
            <ul className="mt-8 grid gap-4 sm:grid-cols-3 lg:grid-cols-1 max-w-2xl">
              {[
                { icon: FileText, t: 'CV không bắt buộc', d: 'Chỉ cần họ tên và số điện thoại' },
                { icon: Wallet, t: 'Không thu phí', d: 'Miễn phí trong toàn bộ quy trình' },
                { icon: ShieldCheck, t: 'Bảo mật thông tin', d: 'Chỉ dùng cho tuyển dụng' },
              ].map(({ icon: Icon, t, d }) => (
                <li key={t} className="flex items-start gap-3">
                  <span className="mt-0.5 w-9 h-9 rounded-lg bg-white/10 ring-1 ring-white/15 flex items-center justify-center shrink-0">
                    <Icon className="w-[18px] h-[18px] text-[#8FB8FF]" />
                  </span>
                  <span>
                    <span className="block text-sm font-bold text-white">{t}</span>
                    <span className="block text-[13px] text-blue-100/75">{d}</span>
                  </span>
                </li>
              ))}
            </ul>
            {/* On phones this is left out: the form comes sooner, and the regions have their own section below. */}
            {regions.length > 0 && (
              <div className="mt-9 hidden lg:block">
                <p className="text-xs font-semibold uppercase tracking-wider text-blue-200/80">Đang tuyển dụng tại</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {regions.map((r) => (
                    <span key={r.region} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/10 ring-1 ring-white/15 text-sm text-white">
                      <MapPin className="w-3.5 h-3.5 text-[#8FB8FF]" /> {r.region}
                      <span className="text-blue-200/80">· {r.locations.length} tỉnh / thành</span>
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
          {card}
        </div>
      </div>

      {/* How it works */}
      <section aria-labelledby="steps-title" className="py-16 lg:py-24 bg-white">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <p className="text-sm font-semibold text-[#0B4A9E]">Quy trình</p>
          <h2 id="steps-title" className="mt-2 text-3xl sm:text-4xl font-extrabold tracking-tight text-slate-900">4 bước để bắt đầu công việc</h2>
          <ol className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map(({ icon: Icon, title, text }, i) => (
              <li key={title} className="relative rounded-xl border border-slate-200 bg-white p-6">
                <div className="flex items-center justify-between">
                  <span className="w-11 h-11 rounded-lg bg-blue-50 text-[#0B4A9E] flex items-center justify-center">
                    <Icon className="w-5 h-5" />
                  </span>
                  <span className="text-4xl font-extrabold text-slate-100 tabular-nums select-none" aria-hidden="true">0{i + 1}</span>
                </div>
                <h3 className="mt-5 text-base font-bold text-slate-900">
                  <span className="sr-only">Bước {i + 1}: </span>
                  {title}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-600">{text}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Where we recruit (from the company's drop-lists) */}
      {regions.length > 0 && (
        <section aria-labelledby="areas-title" className="py-16 lg:py-24 bg-slate-50 border-y border-slate-200">
          <div className="max-w-6xl mx-auto px-4 sm:px-6">
            <p className="text-sm font-semibold text-[#0B4A9E]">Địa điểm làm việc</p>
            <h2 id="areas-title" className="mt-2 text-3xl sm:text-4xl font-extrabold tracking-tight text-slate-900">Khu vực đang tuyển dụng</h2>
            <p className="mt-3 text-slate-600 max-w-2xl">Chọn nơi thuận tiện nhất với bạn ở ô "Khu vực mong muốn làm việc".</p>
            <div className="mt-10 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {regions.map((r) => (
                <div key={r.region} className="rounded-xl bg-white border border-slate-200 p-6">
                  <h3 className="flex items-center gap-2 text-base font-bold text-slate-900">
                    <MapPin className="w-4 h-4 text-[#0B4A9E]" /> {r.region}
                  </h3>
                  <ul className="mt-4 flex flex-wrap gap-2">
                    {r.locations.map((l) => (
                      <li key={l} className="px-2.5 py-1 rounded-md bg-slate-100 text-[13px] text-slate-700">{l}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* FAQ */}
      <section aria-labelledby="faq-title" className="py-16 lg:py-24 bg-white">
        <div className="max-w-3xl mx-auto px-4 sm:px-6">
          <p className="text-sm font-semibold text-[#0B4A9E] text-center">Câu hỏi thường gặp</p>
          <h2 id="faq-title" className="mt-2 text-3xl sm:text-4xl font-extrabold tracking-tight text-slate-900 text-center">Bạn cần biết trước khi ứng tuyển</h2>
          <div className="mt-10 divide-y divide-slate-200 border-y border-slate-200">
            {FAQ.map(({ q, a }) => (
              <details key={q} className="group py-5">
                <summary className="flex items-center justify-between gap-4 cursor-pointer list-none text-base font-semibold text-slate-900 [&::-webkit-details-marker]:hidden">
                  {q}
                  <ChevronDown className="w-5 h-5 text-slate-400 shrink-0 transition-transform group-open:rotate-180" />
                </summary>
                <p className="mt-3 text-[15px] leading-relaxed text-slate-600">{a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* Final call to action */}
      {linkState !== 'bad' && !done && (
        <section className="relative overflow-hidden text-white" style={{ backgroundColor: NAVY }}>
          <div aria-hidden="true" className="absolute -bottom-40 -left-40 w-[480px] h-[480px] rounded-full bg-[#1D5FC2] opacity-25 blur-3xl" />
          <div className="relative max-w-6xl mx-auto px-4 sm:px-6 py-14 flex flex-col md:flex-row md:items-center md:justify-between gap-6">
            <div>
              <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight">Sẵn sàng bắt đầu cùng THE SUPRA?</h2>
              <p className="mt-2 text-blue-100/85">Chỉ mất khoảng 2 phút. Không cần CV.</p>
            </div>
            <button type="button" onClick={goToForm} className="inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-lg bg-white text-[#0A2347] font-bold hover:bg-blue-50 transition-colors">
              Ứng tuyển ngay <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </section>
      )}

      <footer className="bg-white border-t border-slate-200">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 text-sm text-slate-500">
          <img src={logoUrl} alt="THE SUPRA" className="h-9 w-auto self-start" />
          <p className="max-w-xl sm:text-right">
            © {year} THE SUPRA. THE SUPRA không thu phí tuyển dụng dưới bất kỳ hình thức nào. Hãy cảnh giác với các lời mời nộp tiền để được nhận việc.
          </p>
        </div>
      </footer>
    </div>
  );
};
