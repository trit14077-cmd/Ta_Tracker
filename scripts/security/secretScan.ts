// M9-3: quét lộ khóa (service_role, khóa Google, chuỗi kết nối DB…). Chỉ in TÊN mẫu + vị trí, không in giá trị.
//   npx tsx scripts/security/secretScan.ts --bundle frontend/dist   # sau `npm run build --prefix frontend`
//   npx tsx scripts/security/secretScan.ts --history                # toàn bộ lịch sử Git (cần clone đủ: fetch-depth 0)
// Thoát 1 nếu có phát hiện. Quy tắc phát hiện: secretScanLib.ts.
import { spawn } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { createInterface } from 'node:readline';
import { patchScanner, scanText, serverNamesInBundle } from './secretScanLib.ts';

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

function scanBundle(dir: string): number {
  const files = walk(dir).filter((f) => /\.(js|mjs|html|css|map|json|txt)$/i.test(f));
  if (!files.length) {
    console.error(`Không có file bundle trong ${dir} – chạy build trước.`);
    return 2;
  }
  let bad = 0;
  for (const f of files) {
    const text = readFileSync(f, 'utf8');
    const rel = relative(process.cwd(), f);
    for (const h of scanText(text)) {
      console.log(`LỘ KHÓA ${h.kind}: ${rel}:${h.line}`);
      bad++;
    }
    for (const n of serverNamesInBundle(text)) {
      console.log(`TÊN BIẾN CHỈ DÙNG Ở SERVER trong bundle (${n}): ${rel}`);
      bad++;
    }
  }
  console.log(`bundle: ${files.length} file, ${bad} phát hiện`);
  return bad ? 1 : 0;
}

async function scanHistory(): Promise<number> {
  const git = spawn('git', ['log', '-p', '--all', '--no-color', '--no-ext-diff', '--no-textconv', '--unified=0'], { stdio: ['ignore', 'pipe', 'inherit'] });
  const done: Promise<number> = new Promise((r) => git.on('close', (c) => r(c ?? 1)));
  const rl = createInterface({ input: git.stdout, crlfDelay: Infinity });
  const scanner = patchScanner();
  for await (const l of rl) scanner.push(l);
  const hits = scanner.hits;
  const exit = await done;
  if (exit !== 0) {
    console.error('git log lỗi');
    return 2;
  }
  for (const h of hits) console.log(`LỘ KHÓA ${h.kind}: commit ${h.commit} file ${h.file}`);
  console.log(`lịch sử Git: ${hits.length} phát hiện`);
  return hits.length ? 1 : 0;
}

async function main() {
  const args = process.argv.slice(2);
  let code = 0;
  const bi = args.indexOf('--bundle');
  if (bi >= 0) code = Math.max(code, scanBundle(args[bi + 1] ?? 'frontend/dist'));
  if (args.includes('--history')) code = Math.max(code, await scanHistory());
  if (bi < 0 && !args.includes('--history')) {
    console.error('Dùng: --bundle <thư mục> và/hoặc --history');
    code = 2;
  }
  process.exit(code);
}

void main();
