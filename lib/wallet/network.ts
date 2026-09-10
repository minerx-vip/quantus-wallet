import { ApiPromise, HttpProvider } from '@polkadot/api';
import { decodeAddress, encodeAddress } from '@polkadot/util-crypto';
import type { WalletRecord } from './vault';
import { signLocal } from './crypto';
import { feeOnlyExtrinsic } from './transaction';
export const GENESIS =
  '0xfb5487c0be6ae4ade2d41d16e50465129861636c2b8d61fa94d7a19631626fba';
import { RPC, rpc, withDeadline } from './transport';
export { RPC, rpc } from './transport';
export const INDEXER = 'https://sqm.quantus.com/v1/graphql';
export type ChainState = {
  height: number;
  highest: number;
  peers: number;
  spec: number;
  genesis: string;
};
export type Balance = {
  free: bigint;
  spendable: bigint;
  reserved: bigint;
  frozen: bigint;
  existential: bigint;
};
export type Transfer = {
  id: string;
  from_id: string;
  to_id: string;
  amount: string;
  fee: string;
  timestamp: string;
  block: { height: number };
  extrinsic?: { id: string } | null;
};
let apiPromise: Promise<ApiPromise> | undefined;
class OfficialHttpProvider extends HttpProvider {
  override send<T>(method: string, params: unknown[]): Promise<T> {
    return rpc<T>(method, params);
  }
  override clone() {
    return new OfficialHttpProvider(RPC);
  }
}
export async function chainState(): Promise<ChainState> {
  const [genesis, sync, health, version] = await Promise.all([
    rpc<string>('chain_getBlockHash', [0]),
    rpc<{ currentBlock: number; highestBlock: number }>('system_syncState'),
    rpc<{ peers: number }>('system_health'),
    rpc<{ specVersion: number; transactionVersion: number; specName: string }>(
      'state_getRuntimeVersion',
    ),
  ]);
  if (genesis !== GENESIS || version.specName !== 'quantus-runtime')
    throw Error('节点网络不匹配，已停止查询和签名');
  return {
    height: sync.currentBlock,
    highest: sync.highestBlock,
    peers: health.peers,
    spec: version.specVersion,
    genesis,
  };
}
export async function getApi() {
  if (!apiPromise) {
    let expired = false;
    const initializing = ApiPromise.create({
      provider: new OfficialHttpProvider(RPC),
      noInitWarn: true,
      throwOnConnect: true,
    }).then((api) => {
      if (expired || api.genesisHash.toHex() !== GENESIS) {
        void api.disconnect();
        throw Error(expired ? '官方节点初始化已超时' : '节点不是 Quantus 主网');
      }
      return api;
    });
    apiPromise = withDeadline(
      initializing,
      25000,
      '官方节点初始化超时，请稍后重试',
    ).catch((error) => {
      expired = true;
      apiPromise = undefined;
      throw error;
    });
  }
  return apiPromise;
}
export function normalizeAddress(value: string) {
  try {
    return encodeAddress(decodeAddress(value.trim(), false, 189), 189);
  } catch {
    throw Error('收款地址校验失败，请使用 Quantus 地址');
  }
}
export async function getBalance(address: string): Promise<Balance> {
  const api = await getApi();
  const account = await api.query.system.account(normalizeAddress(address));
  const data = account.toJSON() as {
    data: { free: string; reserved: string; frozen: string };
  };
  const free = BigInt(data.data.free),
    frozen = BigInt(data.data.frozen || 0);
  return {
    free,
    frozen,
    reserved: BigInt(data.data.reserved),
    spendable: free > frozen ? free - frozen : 0n,
    existential: BigInt(api.consts.balances.existentialDeposit.toString()),
  };
}
export async function history(
  address: string,
  page: number,
  direction: 'all' | 'in' | 'out',
) {
  const a = normalizeAddress(address);
  const where =
    direction === 'in'
      ? { to_id: { _eq: a } }
      : direction === 'out'
        ? { from_id: { _eq: a } }
        : { _or: [{ from_id: { _eq: a } }, { to_id: { _eq: a } }] };
  const r = await fetch(INDEXER, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
    signal: AbortSignal.timeout(20000),
    body: JSON.stringify({
      query:
        'query History($where: transfer_bool_exp!, $offset: Int!) { transfer(where: $where, limit: 25, offset: $offset, order_by: [{timestamp: desc}, {id: desc}]) { id from_id to_id amount fee timestamp block { height } extrinsic { id } } transfer_aggregate(where: $where) { aggregate { count } } }',
      variables: { where, offset: page * 25 },
    }),
  });
  if (!r.ok) throw Error('交易索引暂时不可用');
  const d = (await r.json()) as {
    errors?: unknown[];
    data: {
      transfer: Transfer[];
      transfer_aggregate: { aggregate: { count: number } };
    };
  };
  if (d.errors) throw Error('交易索引返回错误，请稍后重试');
  return {
    rows: d.data.transfer as Transfer[],
    count: Number(d.data.transfer_aggregate.aggregate.count),
  };
}
export type Quote = {
  walletId: string;
  recipient: string;
  amount: string;
  fee: string;
  encoded: string;
  height: number;
  spec: number;
  nonce: number;
  createdAt: number;
};
export async function prepare(
  w: WalletRecord,
  recipient: string,
  amount: bigint,
): Promise<Quote> {
  const dest = normalizeAddress(recipient);
  if (dest === w.address) throw Error('收款地址与当前钱包相同');
  const api = await getApi();
  const state = await chainState();
  if (state.highest - state.height > 2 || state.peers === 0)
    throw Error('节点尚未同步完成，请稍后转账');
  const version = await rpc<{
    specVersion: number;
    transactionVersion: number;
  }>('state_getRuntimeVersion');
  if (version.specVersion !== 152 || version.transactionVersion !== 6)
    throw Error('主网已升级，需核验新的签名规则后才能转账');
  const nonce = await rpc<number>('system_accountNextIndex', [w.address]);
  const checkpoint = await rpc<string>('chain_getBlockHash', [state.height]);
  const call = api.registry
    .createType('Call', {
      callIndex: api.tx.balances.transferKeepAlive.callIndex,
      args: { dest, value: amount.toString() },
    })
    .toU8a();
  const encoded = await signLocal(w, call, {
    nonce,
    tip: '0',
    period: 64,
    blockNumber: state.height,
    genesisHash: GENESIS,
    blockHash: checkpoint,
    ...version,
  });
  const fee = await rpc<{ partialFee: string }>('payment_queryInfo', [
    feeOnlyExtrinsic(encoded),
  ]);
  const balance = await getBalance(w.address);
  if (amount + BigInt(fee.partialFee) + balance.existential > balance.spendable)
    throw Error('可用余额不足：需覆盖金额、手续费并保留账户最低余额');
  return {
    walletId: w.id,
    recipient: dest,
    amount: amount.toString(),
    fee: fee.partialFee,
    encoded,
    height: state.height,
    spec: version.specVersion,
    nonce,
    createdAt: Date.now(),
  };
}
export async function broadcast(q: Quote, w: WalletRecord) {
  if (q.walletId !== w.id || Date.now() - q.createdAt > 60000)
    throw Error('转账预览已过期，请重新预览');
  const state = await chainState();
  if (state.spec !== q.spec || state.height >= q.height + 60)
    throw Error('链状态已变化，请重新预览');
  if ((await rpc<number>('system_accountNextIndex', [w.address])) !== q.nonce)
    throw Error('账户已有新交易，请重新预览');
  return rpc<string>('author_submitExtrinsic', [q.encoded]);
}
