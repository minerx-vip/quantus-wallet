export const UNIT = 1_000_000_000_000n;
export function parseQtc(value: string): bigint {
  if (!/^(0|[1-9]\d*)(\.\d{1,12})?$/.test(value.trim()))
    throw Error('金额须为正数，最多 12 位小数');
  const [whole, fraction = ''] = value.trim().split('.');
  const result = BigInt(whole) * UNIT + BigInt(fraction.padEnd(12, '0'));
  if (result <= 0n || result > 2n ** 128n - 1n)
    throw Error('转账金额超出有效范围');
  return result;
}
export function formatQtc(value: bigint | string): string {
  const n = BigInt(value);
  return (
    (n / UNIT).toLocaleString('en-US') +
    (n % UNIT
      ? '.' + (n % UNIT).toString().padStart(12, '0').replace(/0+$/, '')
      : '')
  );
}
export function dateAtOffset(iso: string, offset: number): string {
  if (!Number.isInteger(offset) || offset < -12 || offset > 14)
    throw Error('无效时区');
  const d = new Date(new Date(iso).getTime() + offset * 3600000);
  if (Number.isNaN(d.getTime())) return '时间未知';
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

export function formatTimezone(offset: number): string {
  return `UTC${offset >= 0 ? '+' : '−'}${String(Math.abs(offset)).padStart(2, '0')}:00${offset === 8 ? '（北京时间）' : ''}`;
}
