import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  createVault,
  unlock,
  persist,
  seal,
  VAULT_KEY,
} from '../lib/wallet/vault.ts';
import { parseQtc, formatQtc, dateAtOffset } from '../lib/wallet/amount.ts';
import { feeOnlyExtrinsic } from '../lib/wallet/transaction.ts';
import init, {
  account,
  accountFromMnemonic,
  signCall,
} from '../crypto/pkg/quantus_wasm.js';

test('new vault accepts 8 characters and rejects shorter passwords', async () => {
  await assert.rejects(createVault('1234567'), /至少 8 位/);
  const session = await createVault('test1234');
  assert.deepEqual(
    (await unlock(session.serialized, 'test1234')).data.wallets,
    [],
  );
});

test('exact QTC arithmetic and timezone day rollover', () => {
  assert.equal(
    parseQtc('9007199254740993.000000000001'),
    9007199254740993000000000001n,
  );
  assert.equal(formatQtc(1000000000001n), '1.000000000001');
  for (const invalid of ['0', '-1', '1e3', 'NaN', '0.0000000000001'])
    assert.throws(() => parseQtc(invalid));
  assert.equal(dateAtOffset('2026-09-10T20:01:02Z', 8), '2026-09-11 04:01:02');
  assert.equal(dateAtOffset('2026-09-10T01:01:02Z', -8), '2026-09-09 17:01:02');
});

test('vault confidentiality, wrong password, authenticated tamper rejection and stale-tab protection', async () => {
  const session = await createVault('test-only-password-123');
  const wallet = {
    id: 'fixture',
    name: 'private wallet name',
    address: 'fixture address',
    secret: 'fixture secret',
    type: 'seed' as const,
    accountIndex: 0,
    createdAt: '2026-09-10',
  };
  const data = { wallets: [wallet], selectedId: wallet.id };
  const encrypted = await seal(session, data);
  assert(!encrypted.includes(wallet.secret));
  assert(!encrypted.includes(wallet.name));
  assert(!encrypted.includes(wallet.address));
  assert.deepEqual(
    (await unlock(encrypted, 'test-only-password-123')).data,
    data,
  );
  await assert.rejects(unlock(encrypted, 'wrong password'));
  const altered = JSON.parse(encrypted);
  altered.ciphertext =
    (altered.ciphertext[0] === 'A' ? 'B' : 'A') + altered.ciphertext.slice(1);
  await assert.rejects(
    unlock(JSON.stringify(altered), 'test-only-password-123'),
  );
  let stored = session.serialized;
  const storage = {
    getItem: (key: string) => (key === VAULT_KEY ? stored : null),
    setItem: (_key: string, value: string) => {
      stored = value;
    },
  };
  const updated = await persist(session, data, storage);
  assert.equal(stored, updated.serialized);
  await assert.rejects(persist(session, data, storage), /另一个标签页/);
});

test('browser WASM derives distinct HD accounts and strips only signatures for fee queries', async () => {
  await init({
    module_or_path: await readFile(
      new URL('../crypto/pkg/quantus_wasm_bg.wasm', import.meta.url),
    ),
  });
  // Public test fixtures, never use these accounts for funds.
  const seed = new Uint8Array(32);
  const a = account(seed),
    b = account(seed);
  assert.equal(a.address, b.address);
  assert.equal(a.publicKey.length, 2592);
  assert.equal(a.secretKey.length, 4896);
  const phrase =
    'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
  const hd0 = accountFromMnemonic(phrase, 0, 0, 0),
    hd1 = accountFromMnemonic(phrase, 1, 0, 0);
  assert.notEqual(hd0.address, hd1.address);
  const call = new Uint8Array([2, 3, 0, ...a.accountId, 4]);
  const xt = signCall(seed, call, {
    nonce: 0,
    tip: '0',
    period: 64,
    blockNumber: 100,
    genesisHash: '0x' + '09'.repeat(32),
    blockHash: '0x' + '08'.repeat(32),
    specVersion: 152,
    transactionVersion: 6,
  });
  const encoded = '0x' + Buffer.from(xt).toString('hex');
  const dummy = Buffer.from(feeOnlyExtrinsic(encoded).slice(2), 'hex');
  const prefix = [1, 2, 4][xt[0] & 3];
  assert.deepEqual(
    dummy.subarray(0, prefix + 35),
    Buffer.from(xt.subarray(0, prefix + 35)),
  );
  assert(dummy.subarray(prefix + 35, prefix + 35 + 4627).every((v) => v === 0));
  assert.deepEqual(
    dummy.subarray(prefix + 35 + 4627),
    Buffer.from(xt.subarray(prefix + 35 + 4627)),
  );
  assert.notEqual(feeOnlyExtrinsic(encoded), encoded);
  for (const x of [a, b, hd0, hd1]) x.free();
});

// Official quantus-apps public test vector. These words are NOT a user's wallet.
const officialMnemonic =
  'orchard answer curve patient visual flower maze noise retreat penalty cage small earth domain scan pitch bottom crunch theme club client swap slice raven';
test('matches official iPhone wallet HD65, HD87 and early non-HD address vectors', async () => {
  const { deriveWallet, matchMnemonic, signLocal } =
    await import('../lib/wallet/crypto.ts');
  const expected = [
    ['hd65', 0, 'qzoyC4eRTrexYoutXABVsf61QJZxJim3iWvayRQwEjXWgA4mw'],
    ['hd65', 1, 'qzmTuBUzGHX7tohwjJHASSbCt64cJt6WC6j6v1SHpMTL77UyB'],
    ['hd87', 0, 'qzm5QCox8Dp5A3oSXZZYHD8YoYgPz7enykZb6RPUropdCyN5h'],
    ['hd87', 1, 'qzmufPopkLKAwDmTzR5uXg8GMp5sUP48CqafJLUz3fPMSSGSh'],
    ['legacy87', 0, 'qzmTAz3UUw1WGUuVh8nbFmPwcftomduwy6twq6NDR6y9qqtEs'],
  ] as const;
  for (const [derivation, accountIndex, address] of expected) {
    assert.equal(
      (
        await deriveWallet(
          'mnemonic',
          officialMnemonic,
          accountIndex,
          derivation,
        )
      ).address,
      address,
    );
    const record = {
      id: 'official',
      name: 'test',
      type: 'mnemonic' as const,
      secret: officialMnemonic,
      derivation,
      accountIndex,
      address,
      createdAt: '',
    };
    const session = await createVault('test1234');
    const restored = (
      await unlock(
        await seal(session, { wallets: [record], selectedId: record.id }),
        'test1234',
      )
    ).data.wallets[0];
    assert.equal(restored.derivation, derivation);
    const encoded = await signLocal(
      restored,
      new Uint8Array([2, 3, 0, ...new Uint8Array(32), 4]),
      {
        nonce: 0,
        tip: '0',
        period: 0,
        blockNumber: 0,
        genesisHash: '0x' + '09'.repeat(32),
        specVersion: 152,
        transactionVersion: 6,
      },
    );
    const bytes = Buffer.from(encoded.slice(2), 'hex');
    const prefix = [1, 2, 4][bytes[0] & 3];
    assert.equal(bytes[prefix + 34], derivation === 'hd65' ? 1 : 0);
    const masked = Buffer.from(feeOnlyExtrinsic(encoded).slice(2), 'hex');
    const sigLength = derivation === 'hd65' ? 3309 : 4627;
    assert(
      masked
        .subarray(prefix + 35, prefix + 35 + sigLength)
        .every((v) => v === 0),
    );
    assert.deepEqual(
      masked.subarray(prefix + 35 + sigLength),
      bytes.subarray(prefix + 35 + sigLength),
    );
  }
  assert.equal(
    (await deriveWallet('mnemonic', officialMnemonic)).address,
    expected[2][2],
  );
  const matched = await matchMnemonic(officialMnemonic, expected[1][2], 0);
  assert.equal(matched.derivation, 'hd65');
  assert.equal(matched.accountIndex, 1);
  await assert.rejects(
    signLocal(
      {
        id: 'bad',
        name: 'bad',
        type: 'mnemonic',
        secret: officialMnemonic,
        accountIndex: 0,
        address: expected[0][2],
        createdAt: '',
      },
      new Uint8Array(),
      {},
    ),
    /密钥与钱包地址不一致/,
  );
});
