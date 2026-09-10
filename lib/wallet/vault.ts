export const VAULT_KEY = 'quantus.wallet.v1';
const ITERATIONS = 600_000;
const AAD = new TextEncoder().encode('quantus-wallet:v1');
export type WalletRecord = {
  id: string;
  name: string;
  address: string;
  type: 'mnemonic' | 'seed';
  secret: string;
  accountIndex: number;
  createdAt: string;
};
export type VaultData = { wallets: WalletRecord[]; selectedId: string };
export type Envelope = {
  version: 1;
  kdf: 'PBKDF2-SHA256';
  iterations: number;
  salt: string;
  iv: string;
  ciphertext: string;
};
export type Session = {
  key: CryptoKey;
  salt: string;
  serialized: string;
  data: VaultData;
};
const bytes = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const base64 = (b: Uint8Array) => {
  let s = '';
  for (const v of b) s += String.fromCharCode(v);
  return btoa(s);
};
export function parseEnvelope(serialized: string): Envelope {
  if (serialized.length > 8_000_000) throw Error('备份文件过大');
  const e = JSON.parse(serialized);
  if (
    e.version !== 1 ||
    e.kdf !== 'PBKDF2-SHA256' ||
    e.iterations !== ITERATIONS ||
    typeof e.salt !== 'string' ||
    typeof e.iv !== 'string' ||
    typeof e.ciphertext !== 'string' ||
    bytes(e.salt).length !== 16 ||
    bytes(e.iv).length !== 12 ||
    bytes(e.ciphertext).length < 16
  )
    throw Error('不是有效的钱包加密备份');
  return e;
}
async function derive(password: string, salt: string) {
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt: bytes(salt),
      iterations: ITERATIONS,
    },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}
export function validateVault(data: VaultData) {
  if (
    !data ||
    !Array.isArray(data.wallets) ||
    data.wallets.length > 200 ||
    typeof data.selectedId !== 'string'
  )
    throw Error('钱包备份内容无效');
  const ids = new Set();
  for (const w of data.wallets) {
    if (
      !w ||
      typeof w.id !== 'string' ||
      ids.has(w.id) ||
      typeof w.name !== 'string' ||
      w.name.length > 40 ||
      typeof w.address !== 'string' ||
      typeof w.secret !== 'string' ||
      w.secret.length > 1000 ||
      !['mnemonic', 'seed'].includes(w.type) ||
      !Number.isInteger(w.accountIndex) ||
      w.accountIndex < 0 ||
      w.accountIndex > 1000000
    )
      throw Error('钱包备份内容无效');
    ids.add(w.id);
  }
  if (data.wallets.length && !ids.has(data.selectedId))
    throw Error('备份中的当前钱包不存在');
}
export async function unlock(
  serialized: string,
  password: string,
): Promise<Session> {
  const e = parseEnvelope(serialized),
    key = await derive(password, e.salt);
  let plain: ArrayBuffer;
  try {
    plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: bytes(e.iv), additionalData: AAD },
      key,
      bytes(e.ciphertext),
    );
  } catch {
    throw Error('密码不正确，或备份文件已损坏');
  }
  const view = new Uint8Array(plain);
  let data: VaultData;
  try {
    data = JSON.parse(new TextDecoder().decode(view));
    validateVault(data);
  } finally {
    view.fill(0);
  }
  return { key, salt: e.salt, serialized, data };
}
export async function seal(
  session: Pick<Session, 'key' | 'salt'>,
  data: VaultData,
): Promise<string> {
  validateVault(data);
  const iv = crypto.getRandomValues(new Uint8Array(12)),
    plain = new TextEncoder().encode(JSON.stringify(data));
  try {
    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: AAD },
      session.key,
      plain,
    );
    return JSON.stringify({
      version: 1,
      kdf: 'PBKDF2-SHA256',
      iterations: ITERATIONS,
      salt: session.salt,
      iv: base64(iv),
      ciphertext: base64(new Uint8Array(encrypted)),
    });
  } finally {
    plain.fill(0);
  }
}
export async function createVault(password: string): Promise<Session> {
  if (password.length < 8) throw Error('请使用至少 8 位的保险库密码');
  const salt = base64(crypto.getRandomValues(new Uint8Array(16))),
    key = await derive(password, salt),
    data = { wallets: [], selectedId: '' };
  const serialized = await seal({ key, salt }, data);
  return { key, salt, serialized, data };
}
export async function persist(
  session: Session,
  data: VaultData,
  storage: Pick<Storage, 'getItem' | 'setItem'> = localStorage,
): Promise<Session> {
  const serialized = await seal(session, data);
  if (storage.getItem(VAULT_KEY) !== session.serialized)
    throw Error('另一个标签页已更新钱包，请锁定后重新解锁');
  storage.setItem(VAULT_KEY, serialized);
  return { ...session, data, serialized };
}
