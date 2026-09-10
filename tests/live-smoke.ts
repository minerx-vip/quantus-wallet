// Read-only integration check. Never submits a transaction or uses a real secret.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import init, {
  account,
  signCall,
  signCallFromMnemonic65,
} from '../crypto/pkg/quantus_wasm.js';
import {
  getApi,
  getBalance,
  history,
  chainState,
  rpc,
  GENESIS,
} from '../lib/wallet/network.ts';
import { feeOnlyExtrinsic } from '../lib/wallet/transaction.ts';
await init({
  module_or_path: await readFile(
    new URL('../crypto/pkg/quantus_wasm_bg.wasm', import.meta.url),
  ),
});
const seed = new Uint8Array(32);
const a = account(seed);
try {
  const api = await getApi();
  const state = await chainState();
  assert.equal(state.genesis, GENESIS);
  const balance = await getBalance(a.address);
  const records = await history(a.address, 0, 'all');
  const call = api.registry
    .createType('Call', {
      callIndex: api.tx.balances.transferKeepAlive.callIndex,
      args: { dest: a.address, value: '1' },
    })
    .toU8a();
  const version = await rpc<{
    specVersion: number;
    transactionVersion: number;
  }>('state_getRuntimeVersion');
  const hash = await rpc<string>('chain_getBlockHash', [state.height]);
  const xt = signCall(seed, call, {
    nonce: 0,
    tip: '0',
    period: 64,
    blockNumber: state.height,
    genesisHash: GENESIS,
    blockHash: hash,
    ...version,
  });
  const fee = await rpc<{ partialFee: string }>('payment_queryInfo', [
    feeOnlyExtrinsic('0x' + Buffer.from(xt).toString('hex')),
  ]);
  assert(BigInt(fee.partialFee) > 0n);
  const xt65 = signCallFromMnemonic65(
    'orchard answer curve patient visual flower maze noise retreat penalty cage small earth domain scan pitch bottom crunch theme club client swap slice raven',
    call,
    {
      nonce: 0,
      tip: '0',
      period: 64,
      blockNumber: state.height,
      genesisHash: GENESIS,
      blockHash: hash,
      ...version,
    },
    0,
  );
  const fee65 = await rpc<{ partialFee: string }>('payment_queryInfo', [
    feeOnlyExtrinsic('0x' + Buffer.from(xt65).toString('hex')),
  ]);
  assert(BigInt(fee65.partialFee) > 0n);

  console.log(
    JSON.stringify({
      height: state.height,
      spec: state.spec,
      balance: balance.free.toString(),
      historyCount: records.count,
      call: Buffer.from(call).toString('hex'),
      fee: fee.partialFee,
      fee65: fee65.partialFee,
      submitted: false,
    }),
  );
  await api.disconnect();
} finally {
  a.free();
}
