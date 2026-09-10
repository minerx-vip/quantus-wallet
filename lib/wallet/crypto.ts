import { generateMnemonic, validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english';
import type { WalletRecord, Derivation } from './vault';
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
  derivation: Derivation = 'hd87',
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
  if (!['hd65', 'hd87', 'legacy87'].includes(derivation))
    throw Error('不支持的账户类型');
  if (derivation === 'legacy87' && accountIndex !== 0)
    throw Error('旧版非 HD 账户没有账户序号');
  const master =
    type === 'mnemonic' && derivation === 'legacy87'
      ? m.mnemonicToSeed(secret)
      : undefined;
  const seed = type === 'seed' ? unhex(secret) : master?.slice(0, 32);
  master?.fill(0);
  let a;
  try {
    a = seed
      ? m.account(seed!)
      : derivation === 'hd65'
        ? m.accountFromMnemonic65(secret, accountIndex)
        : m.accountFromMnemonic(secret, accountIndex, 0, 0);
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
  const restored = await deriveWallet(
    w.type,
    w.secret,
    w.accountIndex,
    w.derivation ?? 'hd87',
  );
  if (restored.address !== w.address)
    throw Error('本地密钥与钱包地址不一致，请重新导入并核对地址');
  const m = await cryptoModule();
  let result: Uint8Array;
  const master =
    w.type === 'mnemonic' && w.derivation === 'legacy87'
      ? m.mnemonicToSeed(w.secret)
      : undefined;
  const seed = w.type === 'seed' ? unhex(w.secret) : master?.slice(0, 32);
  master?.fill(0);
  try {
    result = seed
      ? m.signCall(seed, call, context)
      : w.derivation === 'hd65'
        ? m.signCallFromMnemonic65(w.secret, call, context, w.accountIndex)
        : m.signCallFromMnemonic(w.secret, call, context, w.accountIndex, 0, 0);
    return hex(result);
  } finally {
    seed?.fill(0);
  }
}

export const derivationLabel = (d: Derivation = 'hd87') =>
  ({
    hd65: '手机钱包新版 · ML-DSA-65',
    hd87: 'HD 账户 · ML-DSA-87（网页原版）',
    legacy87: '早期非 HD 账户 · ML-DSA-87',
  })[d];

/** Local-only matching: never send the mnemonic or candidate addresses to an RPC. */
export async function matchMnemonic(
  input: string,
  expected: string,
  accountIndex: number,
) {
  const indices = [
    accountIndex,
    ...Array.from({ length: 20 }, (_, i) => i).filter(
      (i) => i !== accountIndex,
    ),
  ];
  for (const index of indices) {
    for (const derivation of [
      'hd65',
      'hd87',
      ...(index === 0 ? ['legacy87'] : []),
    ] as Derivation[]) {
      const d = await deriveWallet('mnemonic', input, index, derivation);
      if (d.address === expected)
        return { ...d, derivation, accountIndex: index };
      // Allow the browser to paint progress and handle auto-lock during a local scan.
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }
  throw Error(
    '未匹配到原地址，未导入钱包。已核对两种 HD 账户的 0–19 序号、指定序号及早期非 HD 账户。请检查原钱包的账户序号、助记词是否属于该钱包，以及是否为 Wormhole 地址。',
  );
}
