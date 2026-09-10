import { generateMnemonic, validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english';
import type { WalletRecord } from './vault';
export function newMnemonic() {
  return generateMnemonic(wordlist, 256);
}
export const hex = (b: Uint8Array) =>
  '0x' + Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
export const unhex = (s: string) =>
  Uint8Array.from(s.replace(/^0x/, '').match(/../g) ?? [], (x) =>
    parseInt(x, 16),
  );
let ready: Promise<typeof import('../../crypto/pkg/quantus_wasm')> | undefined;
export async function cryptoModule() {
  if (!ready)
    ready = import('../../crypto/pkg/quantus_wasm')
      .then(async (m) => {
        await m.default();
        return m;
      })
      .catch((e) => {
        ready = undefined;
        throw e;
      });
  return ready;
}
export async function deriveWallet(
  type: 'mnemonic' | 'seed',
  input: string,
  accountIndex = 0,
) {
  const secret =
    type === 'mnemonic'
      ? input.trim().toLowerCase().replace(/\s+/g, ' ')
      : input.trim().replace(/^0x/, '').toLowerCase();
  if (
    !Number.isInteger(accountIndex) ||
    accountIndex < 0 ||
    accountIndex > 1000000
  )
    throw Error('账户序号无效');
  if (type === 'mnemonic' && !validateMnemonic(secret, wordlist))
    throw Error('助记词校验失败，请检查单词、顺序与数量');
  if (type === 'seed' && !/^[0-9a-f]{64}$/.test(secret))
    throw Error('请输入 32 字节私钥种子：64 位十六进制字符');
  const m = await cryptoModule();
  const seed = type === 'seed' ? unhex(secret) : undefined;
  let a;
  try {
    a =
      type === 'mnemonic'
        ? m.accountFromMnemonic(secret, accountIndex, 0, 0)
        : m.account(seed!);
    return { address: a.address, secret };
  } finally {
    a?.free();
    seed?.fill(0);
  }
}
export async function signLocal(
  w: WalletRecord,
  call: Uint8Array,
  context: Record<string, unknown>,
): Promise<string> {
  const m = await cryptoModule();
  let result: Uint8Array;
  const seed = w.type === 'seed' ? unhex(w.secret) : undefined;
  try {
    result =
      w.type === 'mnemonic'
        ? m.signCallFromMnemonic(w.secret, call, context, w.accountIndex, 0, 0)
        : m.signCall(seed!, call, context);
    return hex(result);
  } finally {
    seed?.fill(0);
  }
}
