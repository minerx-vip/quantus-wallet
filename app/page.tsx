'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Wallet,
  ShieldCheck,
  Plus,
  ArrowDownLeft,
  ArrowUpRight,
  LockKeyhole,
  KeyRound,
  ChevronRight,
  RefreshCw,
  Copy,
  Download,
  Settings,
  Trash2,
  Eye,
  Check,
  Upload,
  ArrowLeft,
  Search,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from '@/components/ui/table';
import { Checkbox } from '@/components/ui/checkbox';
import {
  VAULT_KEY,
  createVault,
  unlock,
  persist,
  parseEnvelope,
  type Session,
  type WalletRecord,
} from '@/lib/wallet/vault';
import { newMnemonic, deriveWallet } from '@/lib/wallet/crypto';
import {
  getBalance,
  chainState,
  history,
  prepare,
  broadcast,
  normalizeAddress,
  type Balance,
  type Transfer,
  type ChainState,
  type Quote,
} from '@/lib/wallet/network';
import {
  formatQtc,
  parseQtc,
  dateAtOffset,
  formatTimezone,
} from '@/lib/wallet/amount';

type Flow =
  | 'none'
  | 'vault'
  | 'unlock'
  | 'choose'
  | 'create'
  | 'backup'
  | 'verify'
  | 'import'
  | 'receive'
  | 'send'
  | 'settings'
  | 'remove'
  | 'restore';
const short = (s: string) =>
  s.length > 24 ? s.slice(0, 12) + '…' + s.slice(-10) : s;
const reason = (e: unknown) =>
  e instanceof Error ? e.message : '操作失败，请稍后重试';
export default function Home() {
  const [session, setSession] = useState<Session | null>(null),
    sessionRef = useRef<Session | null>(null);
  const [exists, setExists] = useState(false),
    [flow, setFlow] = useState<Flow>('none'),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [message, setMessage] = useState('');
  const [password, setPassword] = useState(''),
    [repeat, setRepeat] = useState(''),
    [name, setName] = useState(''),
    [secret, setSecret] = useState(''),
    [importType, setImportType] = useState<'mnemonic' | 'seed'>('mnemonic'),
    [accountIndex, setAccountIndex] = useState(0),
    [draft, setDraft] = useState<WalletRecord | null>(null),
    [answers, setAnswers] = useState(['', '', '']),
    [confirmed, setConfirmed] = useState(false);
  const [balance, setBalance] = useState<Balance | null>(null),
    [chain, setChain] = useState<ChainState | null>(null),
    [networkError, setNetworkError] = useState(''),
    [chainError, setChainError] = useState(''),
    [balanceLoading, setBalanceLoading] = useState(false),
    [historyLoading, setHistoryLoading] = useState(false),
    [querying, setQuerying] = useState(false),
    [rows, setRows] = useState<Transfer[]>([]),
    [total, setTotal] = useState(0),
    [historyError, setHistoryError] = useState(''),
    [page, setPage] = useState(0),
    [direction, setDirection] = useState<'all' | 'in' | 'out'>('all'),
    [timezone, setTimezone] = useState(8);
  const [recipient, setRecipient] = useState(''),
    [amount, setAmount] = useState(''),
    [quote, setQuote] = useState<Quote | null>(null),
    [pending, setPending] = useState<
      { hash: string; walletId: string; amount: string }[]
    >([]),
    [restoreText, setRestoreText] = useState(''),
    [lookup, setLookup] = useState(''),
    [lookupAddress, setLookupAddress] = useState('');
  const generation = useRef(0),
    lookupRef = useRef('');
  const w = session?.data.wallets.find((x) => x.id === session.data.selectedId),
    address = lookupAddress || w?.address || '';
  const setCurrent = (s: Session | null) => {
    sessionRef.current = s;
    setSession(s);
  };
  const clearSensitive = () => {
    setPassword('');
    setRepeat('');
    setSecret('');
    setDraft(null);
    setAnswers(['', '', '']);
    setQuote(null);
    setConfirmed(false);
  };
  const close = () => {
    if (busy) return;
    setFlow('none');
    setError('');
    clearSensitive();
  };
  const lock = useCallback(() => {
    generation.current++;
    sessionRef.current = null;
    setSession(null);
    setFlow('none');
    setPassword('');
    setRepeat('');
    setSecret('');
    setDraft(null);
    setQuote(null);
    setAnswers(['', '', '']);
    setBalance(null);
    setRows([]);
    setTotal(0);
    setLookup('');
    setLookupAddress('');
    lookupRef.current = '';
    setPending([]);
    setQuerying(false);
    setBalanceLoading(false);
    setHistoryLoading(false);
    setMessage('保险库已锁定');
  }, []);
  useEffect(() => {
    try {
      const savedVault = !!localStorage.getItem(VAULT_KEY);
      setExists(savedVault);
      if (savedVault) setFlow('unlock');
      const saved = Number(localStorage.getItem('quantus.timezone') ?? 8);
      if (Number.isInteger(saved) && saved >= -12 && saved <= 14)
        setTimezone(saved);
    } catch {
      setError('浏览器禁止本地存储，请允许后重试');
    }
  }, []);
  useEffect(() => {
    if (!session) return;
    let timer: ReturnType<typeof setTimeout>;
    const reset = () => {
      clearTimeout(timer);
      timer = setTimeout(lock, 5 * 60 * 1000);
    };
    const changed = (e: StorageEvent) => {
      if (e.key === VAULT_KEY) lock();
    };
    reset();
    window.addEventListener('pointerdown', reset);
    window.addEventListener('keydown', reset);
    window.addEventListener('storage', changed);
    window.addEventListener('pagehide', lock);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('pointerdown', reset);
      window.removeEventListener('keydown', reset);
      window.removeEventListener('storage', changed);
      window.removeEventListener('pagehide', lock);
    };
  }, [!!session, lock]);
  const refresh = useCallback(async () => {
    if (!address) return;
    const g = ++generation.current;
    const current = () => g === generation.current;
    setQuerying(true);
    setBalanceLoading(true);
    setHistoryLoading(true);
    setNetworkError('');
    setChainError('');
    setHistoryError('');
    await Promise.all([
      getBalance(address)
        .then((value) => {
          if (current()) setBalance(value);
        })
        .catch((e) => {
          if (current()) {
            setBalance(null);
            setNetworkError(reason(e));
          }
        })
        .finally(() => {
          if (current()) setBalanceLoading(false);
        }),
      chainState()
        .then((value) => {
          if (current()) setChain(value);
        })
        .catch((e) => {
          if (current()) {
            setChain(null);
            setChainError(reason(e));
          }
        }),
      history(address, page, direction)
        .then((value) => {
          if (current()) {
            setRows(value.rows);
            setTotal(value.count);
          }
        })
        .catch((e) => {
          if (current()) {
            setRows([]);
            setHistoryError(reason(e));
          }
        })
        .finally(() => {
          if (current()) setHistoryLoading(false);
        }),
    ]);
    if (current()) setQuerying(false);
  }, [address, page, direction]);
  useEffect(() => {
    setBalance(null);
    setRows([]);
    if (address) void refresh();
    return () => {
      generation.current++;
    };
  }, [refresh]);
  useEffect(() => {
    if (!address) return;
    const timer = setInterval(() => void refresh(), 30000);
    return () => clearInterval(timer);
  }, [address, refresh]);
  async function act(fn: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError(reason(e));
    } finally {
      setBusy(false);
    }
  }
  async function save(data: Session['data']) {
    const current = sessionRef.current;
    if (!current) throw Error('钱包已锁定，请重新解锁');
    const next = await persist(current, data);
    if (sessionRef.current !== current)
      throw Error('钱包状态已改变，请重新解锁');
    setCurrent(next);
  }
  function openAdd() {
    setError('');
    setName('');
    clearSensitive();
    setFlow(session ? 'choose' : exists ? 'unlock' : 'vault');
  }
  async function openVault() {
    let restored: Session;
    if (flow === 'vault') {
      if (password !== repeat) throw Error('两次密码不一致');
      if (localStorage.getItem(VAULT_KEY))
        throw Error('当前浏览器已有保险库，请重新打开页面');
      restored = await createVault(password);
      if (localStorage.getItem(VAULT_KEY))
        throw Error('另一个标签页已创建保险库，请刷新后解锁');
      localStorage.setItem(VAULT_KEY, restored.serialized);
      setExists(true);
    } else {
      const raw = localStorage.getItem(VAULT_KEY);
      if (!raw) throw Error('未找到本地保险库');
      restored = await unlock(raw, password);
    }
    setCurrent(restored);
    setPassword('');
    setRepeat('');
    setLookupAddress('');
    lookupRef.current = '';
    setPage(0);
    setFlow(restored.data.wallets.length ? 'none' : 'choose');
    if (restored.data.wallets.length)
      setMessage(`已解锁 ${restored.data.wallets.length} 个本地钱包`);
  }
  async function addWallet(record: WalletRecord) {
    const s = sessionRef.current;
    if (!s) throw Error('请先解锁保险库');
    if (s.data.wallets.some((x) => x.address === record.address))
      throw Error('该地址已在钱包列表中');
    await save({ wallets: [...s.data.wallets, record], selectedId: record.id });
    setLookupAddress('');
    setPage(0);
    setFlow('none');
    clearSensitive();
    setMessage('钱包已加密保存到本机');
  }
  async function generate() {
    const active = sessionRef.current;
    if (!active) throw Error('请先解锁');
    if (!name.trim()) throw Error('请给钱包起一个名称');
    const phrase = newMnemonic(),
      derived = await deriveWallet('mnemonic', phrase);
    if (sessionRef.current !== active) throw Error('保险库已锁定');
    setDraft({
      id: crypto.randomUUID(),
      name: name.trim(),
      address: derived.address,
      type: 'mnemonic',
      secret: derived.secret,
      accountIndex: 0,
      createdAt: new Date().toISOString(),
    });
    setFlow('backup');
  }
  async function importWallet() {
    const d = await deriveWallet(importType, secret, accountIndex);
    if (!name.trim()) throw Error('请填写钱包名称');
    await addWallet({
      id: crypto.randomUUID(),
      name: name.trim(),
      ...d,
      type: importType,
      accountIndex,
      createdAt: new Date().toISOString(),
    });
  }
  async function selectWallet(id: string) {
    if (busy) return;
    await act(async () => {
      await save({ ...session!.data, selectedId: id });
      setLookupAddress('');
      setPage(0);
      setQuote(null);
    });
  }
  function downloadBackup() {
    const raw = localStorage.getItem(VAULT_KEY);
    if (!raw) return;
    const url = URL.createObjectURL(
        new Blob([raw], { type: 'application/json' }),
      ),
      a = document.createElement('a');
    a.href = url;
    a.download =
      'quantus-encrypted-backup-' +
      new Date().toISOString().slice(0, 10) +
      '.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setMessage('已下载加密备份，请同时保管好密码');
  }
  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setMessage('已复制');
    } catch {
      setMessage('复制失败，请手动选择并复制');
    }
  }
  const dialogTitle: Record<Flow, string> = {
    none: '',
    vault: '设置本地保险库',
    unlock: '解锁本地保险库',
    choose: '添加一个钱包',
    create: '创建新钱包',
    backup: '备份助记词',
    verify: '确认你的备份',
    import: '导入已有钱包',
    receive: '收款',
    send: quote ? '确认转账' : '转出 QTC',
    settings: '本地钱包设置',
    remove: '移除此钱包',
    restore: '恢复加密备份',
  };
  return (
    <main className="wallet-app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-icon">Q</span>
          <strong>
            QUANTUS <span>WALLET</span>
          </strong>
        </div>
        <div className="top-actions">
          <div className="network">
            <i /> 主网 <span>QTC</span>
          </div>
          {session && (
            <Button variant="ghost" onClick={lock} aria-label="锁定钱包">
              <LockKeyhole size={18} />
            </Button>
          )}
          <Button
            variant="ghost"
            aria-label="钱包设置"
            onClick={() => {
              setError('');
              setName('');
              setFlow('settings');
            }}
          >
            <Settings size={18} />
          </Button>
        </div>
      </header>
      <div className="workspace">
        <section className="wallet-rail">
          <div className="eyebrow">本地钱包</div>
          <h2>
            我的钱包{' '}
            <span>
              {session?.data.wallets.length ?? (exists ? '已锁定' : '—')}
            </span>
          </h2>
          <div className="wallet-list">
            {session?.data.wallets.map((x) => (
              <button
                key={x.id}
                disabled={busy}
                className={
                  'wallet-item ' +
                  (x.id === w?.id && !lookupAddress ? 'selected' : '')
                }
                onClick={() => void selectWallet(x.id)}
              >
                <span className="wallet-avatar">
                  <Wallet size={18} />
                </span>
                <span>
                  <strong>{x.name}</strong>
                  <small>{short(x.address)}</small>
                </span>
                {x.id === w?.id && !lookupAddress && <i />}
              </button>
            ))}
          </div>
          <Button className="add-wallet" variant="outline" onClick={openAdd}>
            <Plus size={18} /> {exists && !session ? '解锁钱包' : '添加钱包'}
          </Button>
          <div className="rail-note">
            <ShieldCheck size={20} />
            <div>
              只属于你的设备
              <p>钱包资料仅在当前浏览器加密保存。闲置 5 分钟自动锁定。</p>
            </div>
          </div>
          <form
            className="lookup"
            onSubmit={(e) => {
              e.preventDefault();
              try {
                const a = normalizeAddress(lookup);
                setLookupAddress(a);
                lookupRef.current = a;
                setPage(0);
                setError('');
              } catch (e) {
                setError(reason(e));
              }
            }}
          >
            <label htmlFor="lookup">查询公开地址</label>
            <div>
              <Input
                id="lookup"
                placeholder="粘贴 Quantus 地址"
                value={lookup}
                onChange={(e) => setLookup(e.target.value)}
              />
              <Button type="submit" variant="outline" aria-label="查询地址">
                <Search size={16} />
              </Button>
            </div>
          </form>
        </section>
        <section className="wallet-main">
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                {lookupAddress ? '只读查询' : '资产概览'}
              </div>
              <h1>
                {lookupAddress
                  ? '地址查询'
                  : (w?.name ?? (exists ? '本地钱包已锁定' : '钱包总览'))}
              </h1>
            </div>
            {address ? (
              <Button
                disabled={querying}
                variant="ghost"
                onClick={() => void refresh()}
                aria-label="刷新余额"
              >
                <RefreshCw size={20} className={querying ? 'spinning' : ''} />
              </Button>
            ) : (
              <LockKeyhole size={24} />
            )}
          </div>
          {error && flow === 'none' && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          {message && (
            <p className="feedback" role="status">
              {message}
              <button aria-label="关闭提示" onClick={() => setMessage('')}>
                ×
              </button>
            </p>
          )}
          <section className="balance-panel">
            <div className="balance-label">可用余额</div>
            <div className="balance">
              {balance ? (
                formatQtc(balance.spendable)
              ) : address ? (
                <span>
                  {balanceLoading ? '查询中…' : networkError ? '查询失败' : '—'}
                </span>
              ) : (
                '—'
              )}{' '}
              <span>QTC</span>
            </div>
            {address ? (
              <button
                className="address"
                onClick={() => void copy(address)}
                title={address}
              >
                {short(address)} <Copy size={14} />
              </button>
            ) : (
              <p>{exists ? '解锁后查询链上余额' : '添加钱包后查询链上余额'}</p>
            )}
            {balance && (
              <p className="balance-detail">
                总余额 {formatQtc(balance.free + balance.reserved)} · 冻结{' '}
                {formatQtc(balance.frozen)} · 预留 {formatQtc(balance.reserved)}
              </p>
            )}
            <div className="actions">
              <Button
                disabled={!!lookupAddress}
                onClick={() => {
                  if (!w) {
                    openAdd();
                    return;
                  }
                  setError('');
                  setQuote(null);
                  setRecipient('');
                  setAmount('');
                  setFlow('send');
                }}
              >
                <ArrowUpRight /> 转出
              </Button>
              <Button
                variant="outline"
                onClick={() => (address ? setFlow('receive') : openAdd())}
              >
                <ArrowDownLeft /> 收款
              </Button>
            </div>
            <span className="balance-watermark">Q</span>
          </section>
          {networkError && (
            <p className="error" role="alert">
              {networkError}，未显示缓存余额。
            </p>
          )}
          {chainError && (
            <p className="notice">节点状态查询失败：{chainError}</p>
          )}
          {chain && (
            <div className="chain-status">
              <i />
              {chain.height >= chain.highest ? '主网已同步' : '节点追块中'} · #
              {chain.height.toLocaleString()} <span>{chain.peers} 个连接</span>
            </div>
          )}
          {pending
            .filter((p) => p.walletId === w?.id)
            .map((p) => (
              <p className="notice" key={p.hash}>
                已广播 {formatQtc(p.amount)} QTC，等待链上确认。
                <span className="break-all">{p.hash}</span>
                <small>广播成功不代表交易已经执行。请刷新交易记录核对。</small>
              </p>
            ))}
          <div className="section-heading">
            <h2>交易记录</h2>
            <div className="timezone">
              <Select
                value={String(timezone)}
                onValueChange={(v) => {
                  const n = Number(v);
                  setTimezone(n);
                  localStorage.setItem('quantus.timezone', String(n));
                }}
              >
                <SelectTrigger aria-label="记录时区">
                  <SelectValue>{formatTimezone(timezone)}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {Array.from({ length: 27 }, (_, i) => i - 12).map((n) => (
                    <SelectItem key={n} value={String(n)}>
                      {formatTimezone(n)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          {address && (
            <Tabs
              value={direction}
              onValueChange={(v) => {
                setDirection(v as typeof direction);
                setPage(0);
              }}
            >
              <TabsList>
                <TabsTrigger value="all">全部</TabsTrigger>
                <TabsTrigger value="in">转入</TabsTrigger>
                <TabsTrigger value="out">转出</TabsTrigger>
              </TabsList>
            </Tabs>
          )}
          {!address ? (
            <section className="empty-state">
              <Wallet size={32} />
              <h3>
                {exists ? '钱包已保存，等待解锁' : '从你的第一个钱包开始'}
              </h3>
              <p>
                {exists
                  ? '刷新页面会自动锁定，不会删除钱包。输入保险库密码即可恢复钱包列表。'
                  : '创建新钱包，或导入你已有的助记词和私钥。'}
              </p>
              <Button onClick={openAdd}>
                {exists ? '解锁钱包' : '添加钱包'} <ChevronRight />
              </Button>
              {!exists && (
                <Button variant="ghost" onClick={() => setFlow('restore')}>
                  从加密备份恢复
                </Button>
              )}
            </section>
          ) : historyError ? (
            <section className="empty-state">
              <p role="alert">{historyError}</p>
              <Button onClick={() => void refresh()}>重试查询</Button>
            </section>
          ) : rows.length ? (
            <>
              <div className="history-table">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>类型 / 对方地址</TableHead>
                      <TableHead>金额 QTC</TableHead>
                      <TableHead>时间 / 区块</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((t) => {
                      const incoming = t.to_id === address;
                      return (
                        <TableRow key={t.id}>
                          <TableCell>
                            <div className="tx-party">
                              <span className={incoming ? 'in' : 'out'}>
                                {incoming ? (
                                  <ArrowDownLeft size={18} />
                                ) : (
                                  <ArrowUpRight size={18} />
                                )}
                              </span>
                              <div>
                                <strong>
                                  {incoming ? '转入' : '转出'}
                                  {!t.extrinsic ? ' · 系统入账' : ''}
                                </strong>
                                <button
                                  onClick={() =>
                                    void copy(incoming ? t.from_id : t.to_id)
                                  }
                                  title={incoming ? t.from_id : t.to_id}
                                >
                                  {short(incoming ? t.from_id : t.to_id)}
                                </button>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell>
                            <strong className={incoming ? 'positive' : ''}>
                              {incoming ? '+' : '−'}
                              {formatQtc(t.amount)}
                            </strong>
                            {t.fee && BigInt(t.fee) > 0n && (
                              <small>手续费 {formatQtc(t.fee)}</small>
                            )}
                          </TableCell>
                          <TableCell>
                            {dateAtOffset(t.timestamp, timezone)}
                            <small>
                              #{t.block.height.toLocaleString()}{' '}
                              <button
                                onClick={() =>
                                  void copy(t.extrinsic?.id ?? t.id)
                                }
                              >
                                复制交易标识
                              </button>
                            </small>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
              <div className="pagination">
                <span>
                  共 {total} 条 · 第 {page + 1} 页
                </span>
                <div>
                  <Button
                    variant="outline"
                    disabled={page === 0 || querying}
                    onClick={() => setPage((p) => p - 1)}
                  >
                    上一页
                  </Button>
                  <Button
                    variant="outline"
                    disabled={(page + 1) * 25 >= total || querying}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    下一页
                  </Button>
                </div>
              </div>
            </>
          ) : (
            <section className="empty-state">
              <ArrowDownLeft size={28} />
              <h3>
                {historyLoading ? '正在查询链上记录' : '暂无匹配的转账记录'}
              </h3>
              <p>
                显示索引服务收录的转入、转出和系统入账。新交易可能稍有延迟。
              </p>
            </section>
          )}
        </section>
      </div>
      <footer className="security-statement" aria-label="安全声明">
        <strong>安全声明</strong>
        <p>
          本工具由社区开发，按现状提供，未经独立安全审计。请自行备份并核对交易，使用及资产损失风险由用户自行承担。
        </p>
        <p>
          连接{' '}
          <a
            href="https://rpc1-mainnet.quantus.com"
            target="_blank"
            rel="noopener noreferrer"
          >
            Quantus 官方主网节点
          </a>
          （
          <a
            href="https://rpc2-mainnet.quantus.com"
            target="_blank"
            rel="noopener noreferrer"
          >
            官方备用节点
          </a>
          ）与{' '}
          <a
            href="https://sqm.quantus.com/v1/graphql"
            target="_blank"
            rel="noopener noreferrer"
          >
            官方交易索引服务
          </a>
          。查询会发送公开地址；确认转账后发送签名交易。助记词、私钥与密码不会上传。
        </p>
        <p>
          程序开源：
          <a
            href="https://github.com/minerx-vip/quantus-wallet"
            target="_blank"
            rel="noopener noreferrer"
          >
            GitHub · minerx-vip/quantus-wallet ↗
          </a>
          。钱包资料仅在当前浏览器加密保存，清除站点数据前请下载备份。
        </p>
      </footer>
      <Dialog
        open={flow !== 'none'}
        onOpenChange={(v) => {
          if (!v) close();
        }}
      >
        <DialogContent className="wallet-dialog">
          <KeyRound className="dialog-icon" />
          <DialogTitle>{dialogTitle[flow]}</DialogTitle>
          <DialogDescription>
            {flow === 'unlock'
              ? '已找到当前浏览器保存的加密保险库。刷新只会锁定钱包，输入密码后即可恢复钱包列表。'
              : ['vault', 'restore'].includes(flow)
                ? '密码和钱包资料只用于本机解密，不会发送到服务器。'
                : flow === 'send'
                  ? '在浏览器内签名，确认后广播至 Quantus 主网。'
                  : 'Quantus 主网 · 浏览器本地钱包'}
          </DialogDescription>
          {(flow === 'vault' || flow === 'unlock') && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void act(openVault);
              }}
            >
              <label>
                保险库密码
                <Input
                  type="password"
                  autoComplete={
                    flow === 'vault' ? 'new-password' : 'current-password'
                  }
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  minLength={flow === 'vault' ? 8 : 1}
                  required
                  autoFocus
                />
              </label>
              {flow === 'vault' && (
                <>
                  <label>
                    再次输入密码
                    <Input
                      type="password"
                      autoComplete="new-password"
                      value={repeat}
                      onChange={(e) => setRepeat(e.target.value)}
                      minLength={8}
                      required
                    />
                  </label>
                  <p className="notice">
                    至少 8 位。保险库密码不能找回，请另行保存助记词备份。
                  </p>
                </>
              )}
              <Button type="submit" disabled={busy} className="full">
                {busy
                  ? '正在解密 / 加密…'
                  : flow === 'vault'
                    ? '创建保险库'
                    : '解锁'}
              </Button>
            </form>
          )}
          {flow === 'choose' && (
            <div className="choice-list">
              <button
                onClick={() => {
                  setName('钱包 ' + ((session?.data.wallets.length ?? 0) + 1));
                  setFlow('create');
                }}
              >
                <Plus />
                <span>
                  <strong>创建新钱包</strong>
                  <small>生成助记词 → 离线备份 → 确认保存</small>
                </span>
                <ChevronRight />
              </button>
              <button
                onClick={() => {
                  setName('导入钱包');
                  setSecret('');
                  setFlow('import');
                }}
              >
                <Upload />
                <span>
                  <strong>导入已有钱包</strong>
                  <small>助记词或 32 字节私钥种子</small>
                </span>
                <ChevronRight />
              </button>
              <p className="notice">
                当前账户类型为普通 ML-DSA-87 转账地址。Wormhole
                挖矿奖励地址使用独立的生成与证明流程，不能作为普通私钥导入。
              </p>
            </div>
          )}
          {flow === 'create' && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void act(generate);
              }}
            >
              <label>
                钱包名称
                <Input
                  value={name}
                  maxLength={40}
                  required
                  autoFocus
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
              <p className="notice">
                下一步将显示 24
                个助记词。请在安全环境中记录，完成备份验证后才会保存钱包。
              </p>
              <Button type="submit" className="full" disabled={busy}>
                {busy ? '正在本地生成…' : '生成助记词'}
              </Button>
            </form>
          )}
          {flow === 'backup' && draft && (
            <>
              <div className="steps">
                1 生成 <span>→ 2 备份</span> → 3 确认
              </div>
              <div className="mnemonic-grid">
                {draft.secret.split(' ').map((word, i) => (
                  <div key={i}>
                    <span>{i + 1}</span>
                    {word}
                  </div>
                ))}
              </div>
              <p className="notice">
                按顺序抄写在纸上。任何拿到这些词的人都能控制钱包；请勿通过聊天、截图或邮件发送。
              </p>
              <label className="check-label">
                <Checkbox
                  checked={confirmed}
                  onCheckedChange={(v) => setConfirmed(v === true)}
                />{' '}
                我已在离线环境中备份全部 24 个单词
              </label>
              <Button
                disabled={!confirmed}
                onClick={() => {
                  setAnswers(['', '', '']);
                  setFlow('verify');
                }}
              >
                验证备份 <ChevronRight />
              </Button>
            </>
          )}
          {flow === 'verify' && draft && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void act(async () => {
                  const words = draft.secret.split(' ');
                  if (
                    [2, 10, 19].some(
                      (n, i) => answers[i].trim().toLowerCase() !== words[n],
                    )
                  )
                    throw Error('单词不匹配，请对照纸质备份重新输入');
                  await addWallet(draft);
                });
              }}
            >
              <div className="steps">
                1 生成 → 2 备份 <span>→ 3 确认</span>
              </div>
              {[2, 10, 19].map((n, i) => (
                <label key={n}>
                  第 {n + 1} 个单词
                  <Input
                    value={answers[i]}
                    autoComplete="off"
                    spellCheck={false}
                    onChange={(e) =>
                      setAnswers((a) =>
                        a.map((x, j) => (i === j ? e.target.value : x)),
                      )
                    }
                    required
                  />
                </label>
              ))}
              <Button
                variant="ghost"
                type="button"
                onClick={() => setFlow('backup')}
              >
                <ArrowLeft /> 返回备份
              </Button>
              <Button type="submit" disabled={busy}>
                确认并保存钱包
              </Button>
            </form>
          )}
          {flow === 'import' && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void act(importWallet);
              }}
            >
              <Tabs
                value={importType}
                onValueChange={(v) => {
                  setImportType(v as typeof importType);
                  setSecret('');
                  setError('');
                }}
              >
                <TabsList>
                  <TabsTrigger value="mnemonic">助记词</TabsTrigger>
                  <TabsTrigger value="seed">私钥种子</TabsTrigger>
                </TabsList>
              </Tabs>
              <label>
                钱包名称
                <Input
                  value={name}
                  maxLength={40}
                  required
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
              <label>
                {importType === 'mnemonic' ? '英文助记词' : '32 字节私钥种子'}
                <Textarea
                  autoComplete="off"
                  spellCheck={false}
                  value={secret}
                  onChange={(e) => setSecret(e.target.value)}
                  placeholder={
                    importType === 'mnemonic'
                      ? '12 / 15 / 18 / 21 / 24 个单词，以空格分隔'
                      : '64 位十六进制字符，可带 0x 前缀'
                  }
                  required
                />
              </label>
              {importType === 'mnemonic' && (
                <label>
                  账户序号（通常为 0）
                  <Input
                    type="number"
                    min={0}
                    max={1000000}
                    value={accountIndex}
                    onChange={(e) => setAccountIndex(Number(e.target.value))}
                  />
                  <small>派生路径 m/44′/189189′/账户′/0′/0′</small>
                </label>
              )}
              <Button type="submit" className="full" disabled={busy}>
                {busy ? '正在本地验证…' : '验证并导入'}
              </Button>
            </form>
          )}
          {flow === 'receive' && (
            <>
              <p className="notice">
                仅接收 Quantus 主网 QTC。请核对完整地址。
              </p>
              <code className="receive-address">{address}</code>
              <Button onClick={() => void copy(address)}>
                <Copy /> 复制收款地址
              </Button>
            </>
          )}
          {flow === 'send' && w && !quote && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void act(async () =>
                  setQuote(await prepare(w, recipient, parseQtc(amount))),
                );
              }}
            >
              <label>
                收款地址
                <Input
                  value={recipient}
                  onChange={(e) => setRecipient(e.target.value)}
                  placeholder="Quantus 主网地址"
                  autoComplete="off"
                  required
                />
              </label>
              <label>
                转账金额 · QTC
                <Input
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  inputMode="decimal"
                  placeholder="0.00"
                  required
                />
              </label>
              <small>
                可用 {balance ? formatQtc(balance.spendable) : '—'} QTC
              </small>
              <p className="notice">
                下一步显示完整地址、金额和预计手续费。保留账户最低余额，预览有效期为
                60 秒。
              </p>
              <Button type="submit" className="full" disabled={busy}>
                {busy ? '本地签名并估算手续费…' : '预览转账'}
              </Button>
            </form>
          )}
          {flow === 'send' && w && quote && (
            <>
              <dl className="review">
                <dt>从钱包</dt>
                <dd>{w.name}</dd>
                <dt>收款地址</dt>
                <dd className="break-all">{quote.recipient}</dd>
                <dt>金额</dt>
                <dd>{formatQtc(quote.amount)} QTC</dd>
                <dt>预计手续费</dt>
                <dd>{formatQtc(quote.fee)} QTC</dd>
                <dt>预计合计</dt>
                <dd>
                  {formatQtc(BigInt(quote.amount) + BigInt(quote.fee))} QTC
                </dd>
              </dl>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => setQuote(null)}
              >
                返回修改
              </Button>
              <Button
                disabled={busy}
                onClick={() =>
                  void act(async () => {
                    const hash = await broadcast(quote, w);
                    setPending((p) => [
                      ...p,
                      { hash, walletId: w.id, amount: quote.amount },
                    ]);
                    setQuote(null);
                    setFlow('none');
                    setMessage('交易已广播，尚未确认');
                    void refresh();
                  })
                }
              >
                {busy ? '正在广播…' : '确认并广播交易'}
              </Button>
            </>
          )}
          {flow === 'settings' && (
            <>
              <p className="notice">
                助记词、私钥、钱包名称与地址均以 AES-256-GCM
                加密保存。清除站点数据会删除本地保险库。密码和助记词均不会上传。
              </p>
              <Button
                variant="outline"
                disabled={!exists}
                onClick={downloadBackup}
              >
                <Download /> 下载加密备份
              </Button>
              {!exists && (
                <Button variant="outline" onClick={() => setFlow('restore')}>
                  <Upload /> 恢复加密备份
                </Button>
              )}
              {w && (
                <>
                  <label>
                    钱包名称
                    <Input
                      value={name || w.name}
                      maxLength={40}
                      onChange={(e) => setName(e.target.value)}
                    />
                  </label>
                  <Button
                    disabled={busy}
                    variant="outline"
                    onClick={() =>
                      void act(async () => {
                        if (!(name || w.name).trim())
                          throw Error('钱包名称不能为空');
                        await save({
                          ...session!.data,
                          wallets: session!.data.wallets.map((x) =>
                            x.id === w.id
                              ? { ...x, name: (name || w.name).trim() }
                              : x,
                          ),
                        });
                        setMessage('名称已更新');
                        setName('');
                        setFlow('none');
                      })
                    }
                  >
                    保存名称
                  </Button>
                  <Button
                    variant="ghost"
                    className="danger"
                    onClick={() => {
                      setConfirmed(false);
                      setFlow('remove');
                    }}
                  >
                    <Trash2 /> 移除此钱包
                  </Button>
                </>
              )}
              <p className="small-note">
                查询仅发送公开地址；转账发送已签名交易。无统计脚本、无云端钱包账户。Wormhole
                奖励账户的浏览器证明支持仍在验证中。
              </p>
            </>
          )}
          {flow === 'remove' && w && (
            <>
              <p className="notice">
                将从本机移除「{w.name}
                」。链上资金不受影响，恢复钱包需要助记词、私钥或加密备份。
              </p>
              <label className="check-label">
                <Checkbox
                  checked={confirmed}
                  onCheckedChange={(v) => setConfirmed(v === true)}
                />{' '}
                我已备份该钱包
              </label>
              <Button
                disabled={!confirmed || busy}
                variant="destructive"
                onClick={() =>
                  void act(async () => {
                    const remaining = session!.data.wallets.filter(
                      (x) => x.id !== w.id,
                    );
                    await save({
                      wallets: remaining,
                      selectedId: remaining[0]?.id ?? '',
                    });
                    setFlow('none');
                    setMessage('已从本机移除钱包');
                  })
                }
              >
                确认移除
              </Button>
            </>
          )}
          {flow === 'restore' && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void act(async () => {
                  if (localStorage.getItem(VAULT_KEY))
                    throw Error('当前浏览器已有保险库，不能覆盖');
                  const s = await unlock(restoreText, password);
                  for (const x of s.data.wallets) {
                    const d = await deriveWallet(
                      x.type,
                      x.secret,
                      x.accountIndex,
                    );
                    if (d.address !== x.address)
                      throw Error('备份中的地址与密钥不匹配');
                  }
                  localStorage.setItem(VAULT_KEY, s.serialized);
                  setCurrent(s);
                  setExists(true);
                  setPassword('');
                  setRestoreText('');
                  setFlow('none');
                  setMessage('已从加密备份恢复');
                });
              }}
            >
              <label>
                选择本机加密备份
                <Input
                  type="file"
                  accept=".json,application/json"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f)
                      void act(async () => {
                        if (f.size > 8_000_000) throw Error('文件过大');
                        const text = await f.text();
                        parseEnvelope(text);
                        setRestoreText(text);
                      });
                  }}
                />
              </label>
              <label>
                该备份的保险库密码
                <Input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="off"
                  required
                />
              </label>
              <Button
                type="submit"
                disabled={busy || !restoreText}
                className="full"
              >
                在本机解密并恢复
              </Button>
            </form>
          )}
          {error && flow !== 'none' && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
        </DialogContent>
      </Dialog>
    </main>
  );
}
