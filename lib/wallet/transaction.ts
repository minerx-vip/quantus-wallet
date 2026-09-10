/** Fee queries must never expose a usable signature before confirmation. */
export function feeOnlyExtrinsic(encoded: string): string {
  if (!/^0x(?:[0-9a-f]{2})+$/i.test(encoded)) throw Error('Invalid extrinsic');
  const bytes = Uint8Array.from(encoded.slice(2).match(/../g)!, (v) =>
    parseInt(v, 16),
  );
  const mode = bytes[0] & 3;
  const prefix = [1, 2, 4][mode];
  const variant = bytes[prefix + 34];
  const signatureLength = variant === 0 ? 4627 : variant === 1 ? 3309 : 0;
  const publicLength = variant === 0 ? 2592 : 1952;
  if (
    !prefix ||
    bytes[prefix] !== 0x84 ||
    bytes[prefix + 1] !== 0 ||
    !signatureLength ||
    bytes.length < prefix + 35 + signatureLength + publicLength
  ) {
    throw Error('Unsupported extrinsic format');
  }
  bytes.fill(0, prefix + 35, prefix + 35 + signatureLength);
  return (
    '0x' + Array.from(bytes, (v) => v.toString(16).padStart(2, '0')).join('')
  );
}
