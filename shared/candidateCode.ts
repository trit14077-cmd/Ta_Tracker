/**
 * Candidate code auto-generation: the PIC code (the part before "-") + "00" + a running number.
 *   PIC "TA3-Thang"  -> TA30001, TA30002 ...      (TA300 + 01, 02 ...)
 *   PIC "TA1-Phat"   -> TA10001 ...
 * The number is the highest one already used by that PIC plus one, and is bumped until the code is unused anywhere.
 */
export function picCodePrefix(pic: string): string {
  return String(pic || '').split('-')[0].trim();
}

export function nextCandidateCode(
  pic: string,
  picCodes: Iterable<string>,
  isTaken: (code: string) => boolean = () => false
): string {
  const prefix = picCodePrefix(pic);
  if (!prefix) return '';
  const base = prefix + '00';
  const used = new Set<string>();
  let max = 0;
  for (const c of picCodes) {
    used.add(c);
    if (c.startsWith(base)) {
      const tail = c.slice(base.length);
      if (/^\d+$/.test(tail)) max = Math.max(max, Number(tail));
    }
  }
  let n = max + 1;
  let code = base + String(n).padStart(2, '0');
  while (used.has(code) || isTaken(code)) {
    n += 1;
    code = base + String(n).padStart(2, '0');
  }
  return code;
}
