/**
 * Hiring Operation: (Kho, Vị trí) -> Phòng/Ban, Khối, Rank. GENERATED from "Hiring Operation.xlsx" — do not edit by hand.
 * Region and Location are derived from the Site through the Region -> Location -> Site hierarchy.
 * Dept names follow the Drop-list (Coolchain -> Cool Chain, WFM/C&B/HRBP/Recruitment/L&D -> HR, ...).
 * A position with two ranks (e.g. "4C/4B") lists both; the first is the default.
 */

import { normalizePosition } from './positionCatalog.ts';

export type PositionInfo = { dept: string; unit: string; ranks: string[] };

/** [site, position, dept, unit, ranks] */
export const POSITION_ROWS: [string, string, string, string, string[]][] = [["DC Hưng Yên","Trưởng Phòng","Ambient Retail","Chuỗi Cung ứng",["3B"]],
  ["DC Hưng Yên","Trưởng kho","Ambient Retail","Chuỗi Cung ứng",["4A"]],
  ["DC Hưng Yên","Giám sát kho vận","Ambient Retail","Chuỗi Cung ứng",["4B"]],
  ["DC Hưng Yên","Giám sát kế hoạch kho vận","Ambient Retail","Chuỗi Cung ứng",["4B"]],
  ["DC Hưng Yên","Trưởng nhóm Điều phối Kho vận","Ambient Retail","Chuỗi Cung ứng",["4C"]],
  ["DC Hưng Yên","Chuyên viên Điều phối Kho vận/Giao vận/Claim","Ambient Retail","Chuỗi Cung ứng",["5B"]],
  ["DC Hưng Yên","Nhân viên Kho Pick/Pack","Ambient Retail","Chuỗi Cung ứng",["6A"]],
  ["DC Hưng Yên","Nhân viên Kho Fix","Ambient Retail","Chuỗi Cung ứng",["6A"]],
  ["DC Hưng Yên","Nhân viên lái xe nâng Reachtruck","Ambient Retail","Chuỗi Cung ứng",["6A"]],
  ["DC Hưng Yên","Nhân viên Lái xe nâng Forklift","Ambient Retail","Chuỗi Cung ứng",["6A"]],
  ["DC Hưng Yên","Chuyên viên An Ninh","Security & Safety","Chuỗi Cung ứng",["5B"]],
  ["DC Hải Phòng","Trưởng kho","Ambient Retail","Chuỗi Cung ứng",["4A"]],
  ["DC Hải Phòng","Trưởng nhóm Điều phối Kho vận","Ambient Retail","Chuỗi Cung ứng",["4C"]],
  ["DC Hải Phòng","Chuyên viên Điều phối Kho vận/Giao vận/Claim","Ambient Retail","Chuỗi Cung ứng",["5B"]],
  ["DC Hải Phòng","Nhân viên Kho Pick/Pack","Ambient Retail","Chuỗi Cung ứng",["6A"]],
  ["DC Hải Phòng","Nhân viên Kho Fix","Ambient Retail","Chuỗi Cung ứng",["6A"]],
  ["DC Hải Phòng","Nhân viên lái xe nâng Readtruck","Ambient Retail","Chuỗi Cung ứng",["6A"]],
  ["DC Hải Phòng","Nhân viên Lái xe nâng Forklift","Ambient Retail","Chuỗi Cung ứng",["6A"]],
  ["DC Hải Phòng","Chuyên viên hỗ trợ vận hành","Ambient Retail","Chuỗi Cung ứng",["5A"]],
  ["DC Bắc Ninh","Trưởng kho","Ambient Retail","Chuỗi Cung ứng",["4A"]],
  ["DC Bắc Ninh","Trưởng nhóm Điều phối Kho vận","Ambient Retail","Chuỗi Cung ứng",["4C"]],
  ["DC Bắc Ninh","Chuyên viên Điều phối Kho vận/Giao vận/Claim","Ambient Retail","Chuỗi Cung ứng",["5B"]],
  ["DC Bắc Ninh","Nhân viên Kho Pick/Pack","Ambient Retail","Chuỗi Cung ứng",["6A"]],
  ["DC Bắc Ninh","Nhân viên Kho Fix","Ambient Retail","Chuỗi Cung ứng",["6A"]],
  ["DC Bắc Ninh","Nhân viên Lái xe nâng","Ambient Retail","Chuỗi Cung ứng",["6A"]],
  ["DC Bắc Ninh","Chuyên viên hỗ trợ vận hành","Ambient Retail","Chuỗi Cung ứng",["5A"]],
  ["DC Phú Thọ","Trưởng kho","Ambient Retail","Chuỗi Cung ứng",["4A"]],
  ["DC Phú Thọ","Trưởng nhóm Điều phối Kho vận","Ambient Retail","Chuỗi Cung ứng",["4C"]],
  ["DC Phú Thọ","Chuyên viên Điều phối Kho vận/Giao vận/Claim","Ambient Retail","Chuỗi Cung ứng",["5B"]],
  ["DC Phú Thọ","Nhân viên Kho Pick/Pack","Ambient Retail","Chuỗi Cung ứng",["6A"]],
  ["DC Phú Thọ","Nhân viên Kho Fix","Ambient Retail","Chuỗi Cung ứng",["6A"]],
  ["DC Phú Thọ","Nhân viên Lái xe nâng","Ambient Retail","Chuỗi Cung ứng",["6A"]],
  ["DC Bình Dương 1","Trưởng kho","Ambient Retail","Chuỗi Cung ứng",["4A"]],
  ["DC Bình Dương 1","Trưởng nhóm Điều phối Kho vận","Ambient Retail","Chuỗi Cung ứng",["4C"]],
  ["DC Bình Dương 1","Trưởng nhóm Điều phối Giao vận","Ambient Retail","Chuỗi Cung ứng",["4C"]],
  ["DC Bình Dương 1","Chuyên viên Điều phối Kho vận/Giao vận/Claim","Ambient Retail","Chuỗi Cung ứng",["5B"]],
  ["DC Bình Dương 1","Nhân viên Kho","Ambient Retail","Chuỗi Cung ứng",["6A"]],
  ["DC Bình Dương 1","Nhân viên Lái xe nâng","Ambient Retail","Chuỗi Cung ứng",["6A"]],
  ["DC Bình Dương 1","Chuyên viên An Ninh","Security & Safety","Chuỗi Cung ứng",["5B"]],
  ["DC Bình Dương 3","Trưởng nhóm Điều phối Kho vận","Ambient Retail","Chuỗi Cung ứng",["4C"]],
  ["DC Bình Dương 3","Chuyên viên Điều phối Kho vận/Giao vận/Claim","Ambient Retail","Chuỗi Cung ứng",["5B"]],
  ["DC Bình Dương 3","Nhân viên Kho","Ambient Retail","Chuỗi Cung ứng",["6A"]],
  ["DC Bình Dương 3","Nhân viên Lái xe nâng","Ambient Retail","Chuỗi Cung ứng",["6A"]],
  ["DC Bình Dương PL","Trưởng nhóm Điều phối Kho vận","Ambient Retail","Chuỗi Cung ứng",["4C"]],
  ["DC Bình Dương PL","Chuyên viên Điều phối Kho vận/Giao vận/Claim","Ambient Retail","Chuỗi Cung ứng",["5B"]],
  ["DC Bình Dương PL","Nhân viên Kho","Ambient Retail","Chuỗi Cung ứng",["6A"]],
  ["DC Bình Dương PL","Nhân viên Lái xe nâng","Ambient Retail","Chuỗi Cung ứng",["6A"]],
  ["DC Cần Thơ","Trưởng kho","Ambient Retail","Chuỗi Cung ứng",["4A"]],
  ["DC Cần Thơ","Trưởng nhóm Điều phối Kho vận","Ambient Retail","Chuỗi Cung ứng",["4C"]],
  ["DC Cần Thơ","Chuyên viên Điều phối Kho vận/Giao vận/Claim","Ambient Retail","Chuỗi Cung ứng",["5B"]],
  ["DC Cần Thơ","Nhân viên Kho","Ambient Retail","Chuỗi Cung ứng",["6A"]],
  ["DC Cần Thơ","Nhân viên Lái xe nâng","Ambient Retail","Chuỗi Cung ứng",["6A"]],
  ["DC Nghệ An","Trưởng kho","Ambient Retail","Chuỗi Cung ứng",["4A"]],
  ["DC Nghệ An","Trưởng nhóm Điều phối Kho vận","Ambient Retail","Chuỗi Cung ứng",["4C"]],
  ["DC Nghệ An","Chuyên viên Điều phối Kho vận/Giao vận/Claim","Ambient Retail","Chuỗi Cung ứng",["5B"]],
  ["DC Nghệ An","Nhân viên Kho","Ambient Retail","Chuỗi Cung ứng",["6A"]],
  ["DC Nghệ An","Nhân viên Lái xe nâng","Ambient Retail","Chuỗi Cung ứng",["6A"]],
  ["DC Đà Nẵng","Trưởng kho","Ambient Retail","Chuỗi Cung ứng",["4A"]],
  ["DC Đà Nẵng","Trưởng nhóm Điều phối Kho vận","Ambient Retail","Chuỗi Cung ứng",["4C"]],
  ["DC Đà Nẵng","Chuyên viên Điều phối Kho vận/Giao vận/Claim","Ambient Retail","Chuỗi Cung ứng",["5B"]],
  ["DC Khánh Hòa","Trưởng kho","Ambient Retail","Chuỗi Cung ứng",["4A"]],
  ["DC Khánh Hòa","Trưởng nhóm Điều phối Kho vận","Ambient Retail","Chuỗi Cung ứng",["4C"]],
  ["DC Khánh Hòa","Chuyên viên Điều phối Kho vận/Giao vận/Claim","Ambient Retail","Chuỗi Cung ứng",["5B"]],
  ["DC Khánh Hòa","Nhân viên Kho","Ambient Retail","Chuỗi Cung ứng",["6A"]],
  ["DC Khánh Hòa","Nhân viên Lái xe nâng","Ambient Retail","Chuỗi Cung ứng",["6A"]],
  ["DC Khánh Hòa","Chuyên viên hỗ trợ vận hành","Ambient Retail","Chuỗi Cung ứng",["5A"]],
  ["TTPP Hải Phòng","Nhân viên Kiểm soát Dữ liệu Kho vận","Ambient FMCG","Chuỗi Cung ứng",["4C","6A"]],
  ["TTPP Hải Phòng","Chuyên viên Quản lý Kho","Ambient FMCG","Chuỗi Cung ứng",["5C"]],
  ["TTPP Hải Phòng","Thủ Kho","Ambient FMCG","Chuỗi Cung ứng",["6A"]],
  ["TTPP Hải Phòng","Nhân viên Vận hành Kho","Ambient FMCG","Chuỗi Cung ứng",["6B"]],
  ["TTPP Hải Phòng","Nhân viên Lái xe nâng","Ambient FMCG","Chuỗi Cung ứng",["6B"]],
  ["TTPP Hải Dương","Phó Trưởng Bộ Phận Kho Vận","Ambient FMCG","Chuỗi Cung ứng",["4C","4B"]],
  ["TTPP Hải Dương","CV Kiểm Soát Dữ Liệu Kho Vận Cấp Cao","Ambient FMCG","Chuỗi Cung ứng",["5A"]],
  ["TTPP Hải Dương","Chuyên viên Kiểm soát Số liệu Kho vận","Ambient FMCG","Chuỗi Cung ứng",["5C"]],
  ["TTPP Hải Dương","Chuyên viên Quản lý Kho","Ambient FMCG","Chuỗi Cung ứng",["5C"]],
  ["TTPP Hải Dương","Thủ Kho","Ambient FMCG","Chuỗi Cung ứng",["6A"]],
  ["TTPP Hải Dương","Giám Sát An Toàn, Sức Khỏe Và Môi Trường","Ambient FMCG","Chuỗi Cung ứng",["5B"]],
  ["TTPP Hải Dương","Nhân viên Kiểm soát Dữ liệu Kho vận","Ambient FMCG","Chuỗi Cung ứng",["6A"]],
  ["TTPP Hải Dương","Nhân viên Vận hành Kho","Ambient FMCG","Chuỗi Cung ứng",["6B"]],
  ["TTPP Hải Dương","Nhân viên Lái xe nâng","Ambient FMCG","Chuỗi Cung ứng",["6B"]],
  ["TTPP Hưng Yên","Trưởng Bộ Phận Quản Lý Kho Vận Cấp Cao","Ambient FMCG","Chuỗi Cung ứng",["3A"]],
  ["TTPP Hưng Yên","Phó Trưởng BP Kiểm Soát Số Liệu Kho Vận","Ambient FMCG","Chuỗi Cung ứng",["4A"]],
  ["TTPP Hưng Yên","Giám Sát kho","Ambient FMCG","Chuỗi Cung ứng",["4C"]],
  ["TTPP Hưng Yên","Giám Sát Kiểm soát Dữ liệu Kho vận","Ambient FMCG","Chuỗi Cung ứng",["4C"]],
  ["TTPP Hưng Yên","Chuyên Viên Kiểm Soát Dữ Liệu Kho Vận","Ambient FMCG","Chuỗi Cung ứng",["5C"]],
  ["TTPP Hưng Yên","Chuyên viên Quản lý Kho","Ambient FMCG","Chuỗi Cung ứng",["5C"]],
  ["TTPP Hưng Yên","CV An Toàn, Sức Khỏe, Môi Trường","Ambient FMCG","Chuỗi Cung ứng",["5C"]],
  ["TTPP Hưng Yên","Thủ Kho","Ambient FMCG","Chuỗi Cung ứng",["6A"]],
  ["TTPP Hưng Yên","Nhân viên Kiểm soát Dữ liệu Kho vận","Ambient FMCG","Chuỗi Cung ứng",["6A"]],
  ["TTPP Hưng Yên","Nhân viên Vận hành Kho","Ambient FMCG","Chuỗi Cung ứng",["6B"]],
  ["TTPP Hưng Yên","Nhân viên Lái xe nâng","Ambient FMCG","Chuỗi Cung ứng",["6B"]],
  ["TTPP Nghệ An","Trưởng Bộ Phận Trung Tâm Phân Phối","Ambient FMCG","Chuỗi Cung ứng",["4A"]],
  ["TTPP Nghệ An","Giám Sát kho","Ambient FMCG","Chuỗi Cung ứng",["4C","4B"]],
  ["TTPP Nghệ An","Chuyên Viên Kiểm Soát Dữ Liệu Kho Vận","Ambient FMCG","Chuỗi Cung ứng",["5C"]],
  ["TTPP Nghệ An","Chuyên viên Quản lý Kho","Ambient FMCG","Chuỗi Cung ứng",["5C"]],
  ["TTPP Nghệ An","CV An Toàn, Sức Khỏe, Môi Trường Cấp Cao","Ambient FMCG","Chuỗi Cung ứng",["5B"]],
  ["TTPP Nghệ An","Thủ Kho","Ambient FMCG","Chuỗi Cung ứng",["6A"]],
  ["TTPP Nghệ An","Nhân viên Kiểm soát Dữ liệu Kho vận","Ambient FMCG","Chuỗi Cung ứng",["6A"]],
  ["TTPP Nghệ An","Nhân viên Vận hành Kho","Ambient FMCG","Chuỗi Cung ứng",["6B"]],
  ["TTPP Nghệ An","Nhân viên Lái xe nâng","Ambient FMCG","Chuỗi Cung ứng",["6B"]],
  ["TTPP Sóng Thần (Kerry)","Trưởng phòng Quản lý Kho vận","Ambient FMCG","Chuỗi Cung ứng",["3C"]],
  ["TTPP Sóng Thần (Kerry)","Phó Trưởng Bộ Phận Kho Vận","Ambient FMCG","Chuỗi Cung ứng",["4A"]],
  ["TTPP Sóng Thần (Kerry)","Phó Trưởng BP Kiểm Soát Số Liệu Kho Vận","Ambient FMCG","Chuỗi Cung ứng",["4B"]],
  ["TTPP Sóng Thần (Kerry)","Giám Sát kho","Ambient FMCG","Chuỗi Cung ứng",["4C"]],
  ["TTPP Sóng Thần (Kerry)","Giám Sát Kiểm soát Dữ liệu Kho vận","Ambient FMCG","Chuỗi Cung ứng",["4C"]],
  ["TTPP Sóng Thần (Kerry)","Chuyên Viên Kiểm Soát Dữ Liệu Kho Vận","Ambient FMCG","Chuỗi Cung ứng",["5C"]],
  ["TTPP Sóng Thần (Kerry)","Chuyên viên Quản lý Kho","Ambient FMCG","Chuỗi Cung ứng",["5C"]],
  ["TTPP Sóng Thần (Kerry)","SHE","Ambient FMCG","Chuỗi Cung ứng",["5B"]],
  ["TTPP Sóng Thần (Kerry)","Thủ Kho","Ambient FMCG","Chuỗi Cung ứng",["6A"]],
  ["TTPP Sóng Thần (Kerry)","Nhân viên Kiểm soát Dữ liệu Kho vận","Ambient FMCG","Chuỗi Cung ứng",["6A"]],
  ["TTPP Sóng Thần (Kerry)","Nhân viên Lái xe nâng","Ambient FMCG","Chuỗi Cung ứng",["6B"]],
  ["TTPP Sóng Thần (Kerry)","Nhân viên Vận hành Kho","Ambient FMCG","Chuỗi Cung ứng",["6B"]],
  ["TTPP Sóng Thần (TBS)","Giám Sát Kiểm soát Dữ liệu Kho vận","Ambient FMCG","Chuỗi Cung ứng",["4C"]],
  ["TTPP Sóng Thần (TBS)","Thủ Kho","Ambient FMCG","Chuỗi Cung ứng",["6A"]],
  ["TTPP Sóng Thần (TBS)","Nhân viên Kiểm soát Dữ liệu Kho vận","Ambient FMCG","Chuỗi Cung ứng",["6A"]],
  ["TTPP Sóng Thần (TBS)","Chuyên viên Quản lý Kho Cấp cao","Ambient FMCG","Chuỗi Cung ứng",["5C","5B"]],
  ["TTPP Đồng Nai 2","Giám Sát kho","Ambient FMCG","Chuỗi Cung ứng",["4C","4B"]],
  ["TTPP Đồng Nai 2","Giám Sát Kiểm soát Dữ liệu Kho vận","Ambient FMCG","Chuỗi Cung ứng",["4C","4B"]],
  ["TTPP Đồng Nai 2","Chuyên Viên Kiểm Soát Dữ Liệu Kho Vận","Ambient FMCG","Chuỗi Cung ứng",["5C"]],
  ["TTPP Đồng Nai 2","Chuyên viên Quản lý Kho","Ambient FMCG","Chuỗi Cung ứng",["5C"]],
  ["TTPP Đồng Nai 2","Thủ Kho","Ambient FMCG","Chuỗi Cung ứng",["6A"]],
  ["TTPP Đồng Nai 2","Nhân viên Kiểm soát Dữ liệu Kho vận","Ambient FMCG","Chuỗi Cung ứng",["6A"]],
  ["TTPP Đồng Nai 2","Nhân viên Vận hành Kho","Ambient FMCG","Chuỗi Cung ứng",["6B"]],
  ["TTPP Đồng Nai 2","Nhân viên Lái xe nâng","Ambient FMCG","Chuỗi Cung ứng",["6B"]],
  ["TTPP Đồng Nai (Net)","Giám Sát kho","Ambient FMCG","Chuỗi Cung ứng",["4C","4B"]],
  ["TTPP Đồng Nai (Net)","Giám Sát Kiểm soát Dữ liệu Kho vận","Ambient FMCG","Chuỗi Cung ứng",["4C","4B"]],
  ["TTPP Đồng Nai (Net)","Chuyên Viên Kiểm Soát Dữ Liệu Kho Vận","Ambient FMCG","Chuỗi Cung ứng",["5C"]],
  ["TTPP Đồng Nai (Net)","Chuyên viên Quản lý Kho","Ambient FMCG","Chuỗi Cung ứng",["5C"]],
  ["TTPP Đồng Nai (Net)","Thủ Kho","Ambient FMCG","Chuỗi Cung ứng",["6A"]],
  ["TTPP Đồng Nai (Net)","Nhân viên Kiểm soát Dữ liệu Kho vận","Ambient FMCG","Chuỗi Cung ứng",["6A"]],
  ["TTPP Đồng Nai (Net)","Nhân viên Vận hành Kho","Ambient FMCG","Chuỗi Cung ứng",["6B"]],
  ["TTPP Đồng Nai (Net)","Nhân viên Lái xe nâng","Ambient FMCG","Chuỗi Cung ứng",["6B"]],
  ["TTPP Tân Bình","Phó Trưởng Bộ Phận Kho","Ambient FMCG","Chuỗi Cung ứng",["4A"]],
  ["TTPP Tân Bình","Chuyên Viên Kiểm Soát Dữ Liệu Kho Vận","Ambient FMCG","Chuỗi Cung ứng",["5C"]],
  ["TTPP Tân Bình","Chuyên viên Quản lý Kho","Ambient FMCG","Chuỗi Cung ứng",["5C"]],
  ["TTPP Tân Bình","Thủ Kho","Ambient FMCG","Chuỗi Cung ứng",["6A"]],
  ["TTPP Tân Bình","Nhân viên Kiểm soát Dữ liệu Kho vận","Ambient FMCG","Chuỗi Cung ứng",["6A"]],
  ["TTPP Tân Bình","Nhân viên Vận hành Kho","Ambient FMCG","Chuỗi Cung ứng",["6B"]],
  ["TTPP Tân Bình","Nhân viên Lái xe nâng","Ambient FMCG","Chuỗi Cung ứng",["6B"]],
  ["TTPP Hậu Giang","Trưởng phòng Quản lý Kho vận","Ambient FMCG","Chuỗi Cung ứng",["3C"]],
  ["TTPP Hậu Giang","Phó Trưởng Bộ Phận Kho","Ambient FMCG","Chuỗi Cung ứng",["4A"]],
  ["TTPP Hậu Giang","Giám Sát kho","Ambient FMCG","Chuỗi Cung ứng",["4C"]],
  ["TTPP Hậu Giang","Chuyên Viên Kiểm Soát Dữ Liệu Kho Vận","Ambient FMCG","Chuỗi Cung ứng",["5C"]],
  ["TTPP Hậu Giang","Chuyên viên Quản lý Kho","Ambient FMCG","Chuỗi Cung ứng",["5C"]],
  ["TTPP Hậu Giang","Thủ Kho","Ambient FMCG","Chuỗi Cung ứng",["6A"]],
  ["TTPP Hậu Giang","Nhân viên Kiểm soát Dữ liệu Kho vận","Ambient FMCG","Chuỗi Cung ứng",["6A"]],
  ["TTPP Hậu Giang","Nhân viên Vận hành Kho","Ambient FMCG","Chuỗi Cung ứng",["6B"]],
  ["TTPP Hậu Giang","Nhân viên Lái xe nâng","Ambient FMCG","Chuỗi Cung ứng",["6B"]],
  ["TTPP Bình Thuận","Phó Trưởng Bộ Phận Kho Vận","Ambient FMCG","Chuỗi Cung ứng",["4A"]],
  ["TTPP Bình Thuận","Phó Trưởng BP Kiểm Soát Số Liệu Kho Vận","Ambient FMCG","Chuỗi Cung ứng",["4A"]],
  ["TTPP Bình Thuận","Chuyên Viên Kiểm Soát Dữ Liệu Kho Vận","Ambient FMCG","Chuỗi Cung ứng",["5C"]],
  ["TTPP Bình Thuận","Chuyên viên Quản lý Kho","Ambient FMCG","Chuỗi Cung ứng",["5C"]],
  ["TTPP Bình Thuận","Thủ Kho","Ambient FMCG","Chuỗi Cung ứng",["6A"]],
  ["TTPP Bình Thuận","Nhân viên Kiểm soát Dữ liệu Kho vận","Ambient FMCG","Chuỗi Cung ứng",["6A"]],
  ["TTPP Bình Thuận","Nhân viên Vận hành Kho","Ambient FMCG","Chuỗi Cung ứng",["6B"]],
  ["TTPP Bình Thuận","Nhân viên Lái xe","Ambient FMCG","Chuỗi Cung ứng",["6B"]],
  ["TTPP Bình Thuận","Nhân viên Lái xe nâng","Ambient FMCG","Chuỗi Cung ứng",["6B"]],
  ["TTPP Đà Nẵng","Thủ Kho","Ambient FMCG","Chuỗi Cung ứng",["6A"]],
  ["TTPP Đà Nẵng","Chuyên Viên Kiểm Soát Dữ Liệu Kho Vận","Ambient FMCG","Chuỗi Cung ứng",["5C"]],
  ["TTPP Đà Nẵng","Nhân viên Kiểm soát Số liệu Kho vận","Ambient FMCG","Chuỗi Cung ứng",["6A"]],
  ["TTPP Đà Nẵng","Trưởng kho","Ambient FMCG","Chuỗi Cung ứng",["4A"]],
  ["TTPP Phú Yên","Chuyên Viên Kiểm Soát Dữ Liệu Kho Vận","Ambient FMCG","Chuỗi Cung ứng",["5C"]],
  ["TTPP Quang Hanh","Chuyên Viên Kiểm Soát Dữ Liệu Kho Vận","Ambient FMCG","Chuỗi Cung ứng",["5C"]],
  ["TTPP Quang Hanh","Thủ Kho","Ambient FMCG","Chuỗi Cung ứng",["6A"]],
  ["Cool Chain Hà Nam","Nhân viên Quản lý Kho","Cool Chain","Chuỗi Cung ứng",["5C"]],
  ["Cool Chain Hà Nam","Chuyên viên Điều phối Kho vận/Giao vận/Claim","Cool Chain","Chuỗi Cung ứng",["5A"]],
  ["Cool Chain Hà Nam","Phó Trưởng Bộ Phận Kho","Cool Chain","Chuỗi Cung ứng",["4A"]],
  ["Cool Chain 3FF","Công nhân Kho","Cool Chain","Chuỗi Cung ứng",["6B"]],
  ["Cool Chain 3FF","Nhân viên Quản lý Kho","Cool Chain","Chuỗi Cung ứng",["5C"]],
  ["Cool Chain HCM","Nhân viên Điều phối Kho vận","Cool Chain","Chuỗi Cung ứng",["5C"]],
  ["Head Office - HN","Opex Analyst","Transformation","Khối Văn phòng",["4C"]],
  ["Head Office - HN","Opex Specialist","Transformation","Khối Văn phòng",["4C"]],
  ["Head Office - HN","Trưởng phòng Tối ưu Vận hành","Transformation","Khối Văn phòng",["3A"]],
  ["Head Office - HN","Trưởng phòng Phát triển Sản phẩm","Transformation","Khối Văn phòng",["3A"]],
  ["Head Office - HN","Product Operation Lead","Transformation","Khối Văn phòng",["4A"]],
  ["Head Office - HN","Phó Phòng Phân tích Hiệu suất Kho vận","Transformation","Khối Văn phòng",["4A"]],
  ["Head Office","HSE Manager","Transformation","Khối Văn phòng",["3B"]],
  ["Head Office","Category Procurement","MPO","Khối Văn phòng",["4B"]],
  ["Head Office","Transportation Category Procurement","MPO","Khối Văn phòng",["5A"]],
  ["Head Office","Thực tập sinh mua hàng","MPO","Khối Văn phòng",["6C"]],
  ["Head Office","Admin Executive","Administration","Khối Văn phòng",["5A","5B"]],
  ["Head Office","Giám Sát Hoạch định Nguồn lực Thuê Ngoài","HR","Khối Văn phòng",["4B"]],
  ["Head Office","Giám Sát Phân tích Dữ liệu Nhân sự","HR","Khối Văn phòng",["4B","4A"]],
  ["Head Office","Chuyên viên Tiền lương & Phúc lợi","HR","Khối Văn phòng",["5A"]],
  ["Head Office","C&B Supervisor","HR","Khối Văn phòng",["4C"]],
  ["Head Office","C&B Manager","HR","Khối Văn phòng",["4A"]],
  ["Head Office","HRBP Specialist","HR","Khối Văn phòng",["4A"]],
  ["Head Office","Chuyên viên Tuyển dụng","HR","Khối Văn phòng",["5A"]],
  ["Head Office","Operation Training Specialist","HR","Khối Văn phòng",["5A","4C"]],
  ["Head Office","Employee Engagement Specialist","HR","Khối Văn phòng",["4B","4C"]],
  ["Head Office","L&D Manager","HR","Khối Văn phòng",["3C"]],
  ["Head Office","Giám sát Tài chính","Finance","Khối Văn phòng",["4C","4B"]],
  ["Head Office","Chuyên Viên Kiểm soát thanh quyết toán","Finance","Khối Văn phòng",["5A"]],
  ["Head Office","Trưởng phòng Tài chính","Finance","Khối Văn phòng",["4A","3C"]],
  ["Head Office","Chuyên viên Phân tích Hiệu suất Vận tải","Transportation","Khối Văn phòng",["4B","5A"]],
  ["Head Office","Transport Planner","Transportation","Khối Văn phòng",["5B"]],
  ["Head Office","Trưởng phòng Pháp chế","Legal","Khối Văn phòng",["3C"]],
  ["Head Office","Chuyên viên Pháp chế","Legal","Khối Văn phòng",["5A","4C"]],
  ["Head Office","Giám Sát An Toàn Sức Khỏe Và Môi Trường","Transformation","Khối Văn phòng",["4B"]],
  ["Head Office","Thực tập sinh vận hành","Ambient FMCG","Khối Văn phòng",["6C"]],
  ["Head Office","Business Intelligence & Performance Manager","HR","Khối Văn phòng",["3C"]],
  ["Head Office","DRP-Logistics and Transportation Planning Manager","Ambient FMCG","Khối Văn phòng",["3C"]],
  ["Head Office","Giám Sát Phân tích Hiệu suất Kho vận","Ambient FMCG","Khối Văn phòng",["4C"]],
  ["Head Office","Chuyên viên Kế toán","Finance","Khối Văn phòng",["5A"]],
  ["Head Office","Cộng tác viên nhân sự","HR","Khối Văn phòng",["5C"]],
  ["Head Office","Giám sát Quản trị Cơ sở Dữ liệu","IT","Khối Văn phòng",["4C"]]];

/** Positions that appear in Hiring Operation but not in the original Drop-list. */
export const OPERATION_EXTRA_POSITIONS: string[] = [
  "Nhân viên Kho Pick/Pack",
  "Nhân viên Kho Fix",
  "Nhân viên lái xe nâng Reachtruck",
  "Nhân viên Lái xe nâng Forklift",
  "Nhân viên lái xe nâng Readtruck",
  "Phó Trưởng Bộ Phận Kho Vận",
  "CV Kiểm Soát Dữ Liệu Kho Vận Cấp Cao",
  "Chuyên viên Kiểm soát Số liệu Kho vận",
  "Giám Sát An Toàn, Sức Khỏe Và Môi Trường",
  "Trưởng Bộ Phận Quản Lý Kho Vận Cấp Cao",
  "Phó Trưởng BP Kiểm Soát Số Liệu Kho Vận",
  "Giám Sát Kiểm soát Dữ liệu Kho vận",
  "CV An Toàn, Sức Khỏe, Môi Trường",
  "Trưởng Bộ Phận Trung Tâm Phân Phối",
  "CV An Toàn, Sức Khỏe, Môi Trường Cấp Cao",
  "Trưởng phòng Quản lý Kho vận",
  "Nhân viên Lái xe",
  "Nhân viên Kiểm soát Số liệu Kho vận",
  "Giám Sát Phân tích Hiệu suất Kho vận"
];

const norm = (s: string) => (s || '').normalize('NFC').replace(/s+/g, ' ').trim().toLowerCase();
const key = (site: string, position: string) => norm(site) + '||' + norm(position);

const MAP = new Map<string, PositionInfo>(POSITION_ROWS.map(([s, p, d, u, r]) => [key(s, p), { dept: d, unit: u, ranks: r }]));

/** Counts, most frequent first. */
function rank<T>(items: T[]): T[] {
  const c = new Map<T, number>();
  for (const x of items) c.set(x, (c.get(x) || 0) + 1);
  return [...c.entries()].sort((a, b) => b[1] - a[1]).map((e) => e[0]);
}

// Principle 1 — the SITE decides Unit and Dept (when one Dept covers >= 60% of the site's rows;
// Head Office mixes many Depts, so there the POSITION decides the Dept).
const SITE = new Map<string, { unit: string; dept: string }>();
for (const site of new Set(POSITION_ROWS.map((r) => norm(r[0])))) {
  const rows = POSITION_ROWS.filter((r) => norm(r[0]) === site);
  const top = rank(rows.map((r) => r[2]))[0];
  const share = rows.filter((r) => r[2] === top).length / rows.length;
  SITE.set(site, { unit: rows[0][3], dept: share >= 0.6 ? top : '' });
}

// Principle 2 — the POSITION decides Rank (same rank at almost every site; when sites differ, the rank used by
// most rows comes first and the others are still offered) and, for Head Office positions, the Dept.
const POS = new Map<string, { ranks: string[]; dept: string }>();
for (const position of new Set(POSITION_ROWS.map((r) => norm(r[1])))) {
  const rows = POSITION_ROWS.filter((r) => norm(r[1]) === position);
  const ranks = rank(rows.flatMap((r) => r[4]));
  const depts = new Set(rows.map((r) => r[2]));
  POS.set(position, { ranks, dept: depts.size === 1 ? [...depts][0] : '' });
}

/** Sites with no row in Hiring Operation: every DC is Ambient Retail, every TTPP is Ambient FMCG, Cool Chain sites are Cool Chain. */
function siteByName(site: string): { unit: string; dept: string } | undefined {
  const n = norm(site);
  if (n.startsWith('dc ')) return { unit: 'Chuỗi Cung ứng', dept: 'Ambient Retail' };
  if (n.startsWith('ttpp')) return { unit: 'Chuỗi Cung ứng', dept: 'Ambient FMCG' };
  if (n.startsWith('cool chain')) return { unit: 'Chuỗi Cung ứng', dept: 'Cool Chain' };
  if (n.startsWith('head office')) return { unit: 'Khối Văn phòng', dept: '' };
  return undefined;
}

export type PositionLookup = PositionInfo & { exact: boolean };

/**
 * Fills Unit, Dept and Rank from a Site and/or Position.
 * 1) The (Site, Position) pair is in Hiring Operation: use it as is (exact = true).
 * 2) Otherwise derive it: Site gives Unit and Dept, Position gives Rank (and Dept for Head Office) (exact = false).
 * Returns null when neither the Site nor the Position is known.
 */
export function lookupPositionInfo(site: string, position: string): PositionLookup | null {
  const normPos = normalizePosition(position);
  const exact = site && normPos ? MAP.get(key(site, normPos)) : undefined;
  if (exact) return { ...exact, exact: true };
  const s = site ? SITE.get(norm(site)) ?? siteByName(site) : undefined;
  const p = normPos ? POS.get(norm(normPos)) : undefined;
  if (!s && !p) return null;
  return { dept: s?.dept || p?.dept || '', unit: s?.unit || '', ranks: p?.ranks || [], exact: false };
}

/** Ranks from lowest (6C) to highest (2A): a larger number is a lower level; within a number C < B < A. */
export const RANK_LOW_TO_HIGH = ['6C', '6B', '6A', '5C', '5B', '5A', '4C', '4B', '4A', '3C', '3B', '3A', '2C', '2B', '2A'];

/** 0 = Chuỗi Cung ứng (any DC / TTPP / Cool Chain site), 1 = Khối Văn phòng (Head Office only, and every position not in Hiring Operation). */
function positionGroup(position: string): number {
  const p = norm(normalizePosition(position));
  const units = new Set(POSITION_ROWS.filter((r) => norm(r[1]) === p).map((r) => r[3]));
  return units.has('Chuỗi Cung ứng') ? 0 : 1;
}

/** Heading shown above a position in the dropdown. */
export const POSITION_GROUP_LABELS = ['Chuỗi Cung ứng', 'Khối Văn phòng'];
export const positionGroupLabel = (position: string): string => POSITION_GROUP_LABELS[positionGroup(position)];

/** Positions ordered: Chuỗi Cung ứng, then Khối Văn phòng (including positions missing from Hiring Operation, which have no rank and come last); each from low rank to high rank, then A-Z. */
export function sortPositions(list: string[]): string[] {
  const keyOf = (p: string) => {
    const r = POS.get(norm(normalizePosition(p)))?.ranks[0];
    const i = r ? RANK_LOW_TO_HIGH.indexOf(r) : -1;
    return [positionGroup(p), i < 0 ? 99 : i] as const;
  };
  return [...list].sort((a, b) => {
    const ka = keyOf(a), kb = keyOf(b);
    return ka[0] - ka[1] || a.localeCompare(b, 'vi');
  });
}

/** Sites that have at least one entry for this position (empty when the position is unknown). */
export function sitesForPosition(position: string): string[] {
  const p = norm(normalizePosition(position));
  return POSITION_ROWS.filter((r) => norm(r[1]) === p).map((r) => r[0]);
}
