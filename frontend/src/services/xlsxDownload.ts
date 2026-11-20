// Tải bảng ra file .xlsx – dùng chung cho xuất danh sách (M7-5), file mẫu và file lỗi nhập (M7-4).
// SheetJS bản vá 0.20.3 (cdn.sheetjs.com) – bản 0.18.5 trên npm của hệ cũ có lỗ hổng khi đọc file lạ.

/** = downloadXlsx của hệ cũ. */
export async function downloadXlsx(filename: string, rows: (string | number)[][], sheetName: string, widths?: number[]): Promise<void> {
  const XLSX = await import('xlsx');
  const ws = XLSX.utils.aoa_to_sheet(rows);
  if (widths) ws['!cols'] = widths.map((wch) => ({ wch }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
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
