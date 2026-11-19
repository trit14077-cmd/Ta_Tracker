/**
 * Duplicate candidates are found by PHONE NUMBER (the same name alone is not a duplicate; the same phone is the same
 * person). The server attaches this info to each row it returns; nothing is stored.
 *  - Admin gets the codes (and PIC) of the other profiles.
 *  - A TA gets the codes of their OWN other profiles and only a COUNT of other TAs' profiles (no names, no codes).
 */
export interface DupInfo {
  count: number;
  with?: { code: string; pic: string }[];
  own?: string[];
  others?: number;
}

export function dupText(d: DupInfo): string {
  if (d.with) {
    return `Trùng số điện thoại với ${d.count} hồ sơ khác: ${d.with.map((x) => (x.pic ? `${x.code} (${x.pic})` : x.code)).join(', ')}`;
  }
  const parts: string[] = [];
  if (d.own && d.own.length) parts.push(`hồ sơ của bạn: ${d.own.join(', ')}`);
  if (d.others) parts.push(`${d.others} hồ sơ của TA khác (liên hệ Admin)`);
  return `Trùng số điện thoại với ${parts.join(' và ')}`;
}
