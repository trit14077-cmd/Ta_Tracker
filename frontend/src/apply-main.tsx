import { createRoot } from 'react-dom/client';
import { PublicApplyForm } from './components/PublicApplyForm.tsx';
import { applicationsService } from './services/applicationsService.ts';
import './index.css';

// Trang tuyển dụng công khai (M7-3; = apply-main.tsx hệ cũ). Mã TA lấy từ ?apply=... ('' = link chung). Gửi qua Edge `apply`.
createRoot(document.getElementById('root')!).render(<PublicApplyForm code={applicationsService.launchApplyCode()} />);
