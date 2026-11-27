// Tải bảng ra file .xlsx – dùng chung cho xuất danh sách (M7-5), file mẫu và file lỗi nhập (M7-4).
// SheetJS bản vá 0.20.3 (cdn.sheetjs.com) – bản 0.18.5 trên npm của hệ cũ có lỗ hổng khi đọc file lạ.

/** = downloadXlsx của hệ cũ. */
export async function downloadXlsx(filename: string, rows: (string | number)[][], sheetName: string, widths?: number[]): Promise<void> {
  await downloadXlsxBook(filename, [{ name: sheetName, rows, widths }]);
}

/** Nhiều sheet trong một file (bonus: danh sách + Summary + MoM). Tên sheet tối đa 31 ký tự (giới hạn Excel). */
export async function downloadXlsxBook(filename: string, sheets: { name: string; rows: (string | number)[][]; widths?: number[] }[]): Promise<void> {
  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();
  for (const s of sheets) {
    const ws = XLSX.utils.aoa_to_sheet(s.rows);
    if (s.widths) ws['!cols'] = s.widths.map((wch) => ({ wch }));
    XLSX.utils.book_append_sheet(wb, ws, s.name.slice(0, 31));
  }
  const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  const url = URL.createObjectURL(new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
