export const RPC = 'https://rpc1-mainnet.quantus.com';
export const OFFICIAL_RPC = [RPC, 'https://rpc2-mainnet.quantus.com'] as const;
class RpcResponseError extends Error {}

export function createRpcClient(
  fetcher: typeof fetch = globalThis.fetch,
  timeout = 8000,
) {
  let preferred: string = RPC;
  return async function call<T>(
    method: string,
    params: unknown[] = [],
  ): Promise<T> {
    const broadcast = method === 'author_submitExtrinsic';
    const endpoints = broadcast
      ? [preferred]
      : [preferred, ...OFFICIAL_RPC.filter((x) => x !== preferred)];
    for (const endpoint of endpoints) {
      try {
        const response = await fetcher(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
          credentials: 'omit',
          referrerPolicy: 'no-referrer',
          signal: AbortSignal.timeout(timeout),
        });
        if (!response.ok) throw Error(`HTTP ${response.status}`);
        const data = (await response.json()) as {
          result: T;
          error?: { message?: string };
        };
        if (data.error)
          throw new RpcResponseError(data.error.message || '节点请求失败');
        if (!('result' in data)) throw Error('Invalid RPC response');
        preferred = endpoint;
        return data.result;
      } catch (error) {
        // An explicit RPC rejection is not a connectivity failure. Never silently
        // rebroadcast when the first node may already have accepted a transaction.
        if (error instanceof RpcResponseError) throw error;
        if (broadcast)
          throw Error('提交结果未知：连接中断，请先查询交易状态，勿重复转账');
      }
    }
    throw Error('暂时无法连接两个官方主网节点，请检查网络后重试');
  };
}
export const rpc = createRpcClient();

export async function withDeadline<T>(
  task: Promise<T>,
  timeout: number,
  message: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([
      task,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(Error(message)), timeout);
      }),
    ]);
  } finally {
    clearTimeout(timer!);
  }
}
