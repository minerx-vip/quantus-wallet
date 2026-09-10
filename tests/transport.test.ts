import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createRpcClient,
  OFFICIAL_RPC,
  withDeadline,
} from '../lib/wallet/transport.ts';
test('read requests fail over to the second official node and retain it', async () => {
  const hosts: string[] = [];
  const client = createRpcClient((async (url: unknown) => {
    hosts.push(String(url));
    return String(url) === OFFICIAL_RPC[0]
      ? new Response('', { status: 503 })
      : Response.json({ jsonrpc: '2.0', id: 1, result: 123 });
  }) as typeof fetch);
  assert.equal(await client('chain_getHeader'), 123);
  assert.equal(await client('chain_getHeader'), 123);
  assert.deepEqual(hosts, [OFFICIAL_RPC[0], OFFICIAL_RPC[1], OFFICIAL_RPC[1]]);
});
test('explicit RPC rejections and uncertain broadcasts are not retried', async () => {
  let requests = 0;
  const rejected = createRpcClient((async () => {
    requests++;
    return Response.json({ error: { message: 'Invalid Transaction' } });
  }) as typeof fetch);
  await assert.rejects(rejected('payment_queryInfo'), /Invalid Transaction/);
  assert.equal(requests, 1);
  requests = 0;
  const lost = createRpcClient((async () => {
    requests++;
    throw Error('offline');
  }) as typeof fetch);
  await assert.rejects(
    lost('author_submitExtrinsic', ['dummy']),
    /提交结果未知/,
  );
  assert.equal(requests, 1);
});
test('stalled initialization has a bounded deadline', async () => {
  await assert.rejects(
    withDeadline(new Promise(() => {}), 10, '初始化超时'),
    /初始化超时/,
  );
});
