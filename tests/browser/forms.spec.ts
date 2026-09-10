import fixture from '../fixtures/mainnet-readonly-rpc.json' with { type: 'json' };
import { test, expect } from '@playwright/test';
import { encodeAddress } from '@polkadot/util-crypto';
import { createVault, seal } from '../../lib/wallet/vault';
const recipient = encodeAddress(new Uint8Array(32), 189);
test('balance uses the second official node and displays before a slow history service', async ({
  page,
}) => {
  const responses = fixture as Record<string, unknown>;
  const missing: string[] = [];
  await page.route('https://rpc2-mainnet.quantus.com/**', async (route) => {
    const request = route.request().postDataJSON();
    const key = JSON.stringify([request.method, request.params]);
    if (!(key in responses)) {
      missing.push(key);
      await route.fulfill({
        json: {
          jsonrpc: '2.0',
          id: request.id,
          error: { message: 'Missing fixture' },
        },
      });
      return;
    }
    await route.fulfill({
      json: { jsonrpc: '2.0', id: request.id, result: responses[key] },
    });
  });
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('https://sqm.quantus.com/**', async (route) => {
    await blocked;
    await route.fulfill({
      json: {
        data: { transfer: [], transfer_aggregate: { aggregate: { count: 0 } } },
      },
    });
  });
  try {
    await page.getByLabel('查询公开地址').fill(recipient);
    await page.getByRole('button', { name: '查询地址', exact: true }).click();
    await expect(page.locator('.balance')).toHaveText('0 QTC', {
      timeout: 10000,
    });
    await expect(
      page.getByRole('heading', { name: '正在查询链上记录' }),
    ).toBeVisible();
    expect(missing).toEqual([]);
  } finally {
    release();
  }
  await expect(
    page.getByRole('heading', { name: '暂无匹配的转账记录' }),
  ).toBeVisible();
});
test('timezone shows its full label before opening and after selecting or reloading', async ({
  page,
}) => {
  const picker = page.getByRole('combobox', { name: '记录时区' });
  await expect(picker.locator('[data-slot=select-value]')).toHaveText(
    'UTC+08:00（北京时间）',
  );
  await picker.click();
  await page.getByRole('option', { name: 'UTC−05:00', exact: true }).click();
  await expect(picker.locator('[data-slot=select-value]')).toHaveText(
    'UTC−05:00',
  );
  await page.reload();
  await expect(picker.locator('[data-slot=select-value]')).toHaveText(
    'UTC−05:00',
  );
});
test('security statement lives in the wallet rail with visible official and source links', async ({
  page,
}) => {
  const rail = page.locator('.wallet-rail');
  const statement = rail.getByLabel('安全声明', { exact: true });
  await expect(statement).toBeVisible();
  await expect(
    statement.getByRole('link', { name: /连接官方主网节点/ }),
  ).toBeVisible();
  await expect(statement.getByRole('link', { name: /程序开源/ })).toBeVisible();
  await expect(statement).toContainText('使用与资产损失风险自行承担');
  await expect(page.locator('footer.security-statement')).toHaveCount(0);
  await statement.getByText('查看完整声明', { exact: true }).click();
  await expect(statement.getByText(/助记词、私钥与密码不会上传/)).toBeVisible();
});
test.beforeEach(async ({ page }) => {
  // Deterministic offline UI tests: no wallet data or transaction leaves the browser.
  await page.route(
    /^https:\/\/(rpc[12]-mainnet\.quantus\.com|sqm\.quantus\.com)\//,
    (route) => route.fulfill({ status: 503, body: 'Unavailable' }),
  );
  await page.goto('./');
});
test('query click submits and Enter remains supported', async ({ page }) => {
  await page.getByLabel('查询公开地址').fill('invalid-address');
  await page.getByRole('button', { name: '查询地址', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('地址校验失败');
  await page.getByLabel('查询公开地址').fill(recipient);
  await page.getByRole('button', { name: '查询地址', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: '地址查询', exact: true }),
  ).toBeVisible();
  await page.getByLabel('查询公开地址').fill('invalid-again');
  await page.getByLabel('查询公开地址').press('Enter');
  await expect(
    page.getByRole('alert').filter({ hasText: '地址校验失败' }),
  ).toBeVisible();
});
test('8-character vault, generation, backup confirmation and unlock submit on click', async ({
  page,
}) => {
  await page
    .getByRole('button', { name: '添加钱包', exact: true })
    .first()
    .click();
  await page.getByLabel('保险库密码', { exact: true }).fill('test1234');
  await page.getByLabel('再次输入密码').fill('test1234');
  await page.getByRole('button', { name: '创建保险库', exact: true }).click();
  await page.getByRole('button', { name: /创建新钱包/ }).click();
  await page.getByRole('button', { name: '生成助记词', exact: true }).click();
  await expect(page.locator('.mnemonic-grid > div')).toHaveCount(24);
  const words = await page
    .locator('.mnemonic-grid > div')
    .evaluateAll((nodes) =>
      nodes.map((n) => n.childNodes[n.childNodes.length - 1].textContent!),
    );
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: /验证备份|下一步|已备份/ }).click();
  for (const n of [3, 11, 20])
    await page.getByLabel(`第 ${n} 个单词`).fill(words[n - 1]);
  await page.getByRole('button', { name: '确认并保存钱包' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: '锁定钱包' }).click();
  await page
    .getByRole('button', { name: '解锁钱包', exact: true })
    .first()
    .click();
  await page.getByLabel('保险库密码', { exact: true }).fill('test1234');
  await page.getByRole('button', { name: '解锁', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(
    page.getByRole('heading', { name: '钱包 1', exact: true }),
  ).toBeVisible();
});

test('seed import, transfer validation and encrypted backup restore submit on click', async ({
  page,
}, testInfo) => {
  await page
    .getByRole('button', { name: '添加钱包', exact: true })
    .first()
    .click();
  await page.getByLabel('保险库密码', { exact: true }).fill('test1234');
  await page.getByLabel('再次输入密码').fill('test1234');
  await page.getByRole('button', { name: '创建保险库', exact: true }).click();
  await page.getByRole('button', { name: /导入已有钱包/ }).click();
  await page.getByRole('tab', { name: '私钥种子' }).click();
  await page
    .getByLabel('32 字节私钥种子', { exact: true })
    .fill('00'.repeat(32));
  await page.getByRole('button', { name: '验证并导入', exact: true }).click();
  await page
    .getByRole('button', { name: '地址一致，确认导入', exact: true })
    .click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(
    page.getByRole('heading', { name: '导入钱包', exact: true }),
  ).toBeVisible();
  const ciphertext = await page.evaluate(() =>
    localStorage.getItem('quantus.wallet.v1'),
  );
  expect(ciphertext).toBeTruthy();
  await page.reload();
  expect(
    await page.evaluate(
      (value) => localStorage.getItem('quantus.wallet.v1') === value,
      ciphertext,
    ),
  ).toBe(true);
  await expect(page.getByRole('dialog')).toContainText(
    '已找到当前浏览器保存的加密保险库',
  );
  await page.getByLabel('保险库密码', { exact: true }).fill('test1234');
  await page.getByRole('button', { name: '解锁', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(
    page.getByRole('heading', { name: '导入钱包', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: '转出', exact: true }).click();
  await page.getByLabel('收款地址', { exact: true }).fill('invalid');
  await page.getByLabel('转账金额 · QTC').fill('1');
  await page.getByRole('button', { name: '预览转账' }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText(
    '地址校验失败',
  );
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '钱包设置' }).click();
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: '下载加密备份' }).click();
  const backup = testInfo.outputPath('test-fixture-backup.json');
  await (await downloading).saveAs(backup);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.getByRole('button', { name: '从加密备份恢复' }).click();
  await page.getByLabel('选择本机加密备份').setInputFiles(backup);
  await page.getByLabel('该备份的保险库密码').fill('test1234');
  await page.getByRole('button', { name: '在本机解密并恢复' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(
    page.getByRole('heading', { name: '导入钱包', exact: true }),
  ).toBeVisible();
});

test('official phone mnemonic matches original address locally before save and survives refresh', async ({
  page,
}, testInfo) => {
  const mnemonic =
    'orchard answer curve patient visual flower maze noise retreat penalty cage small earth domain scan pitch bottom crunch theme club client swap slice raven';
  const original = 'qzmTuBUzGHX7tohwjJHASSbCt64cJt6WC6j6v1SHpMTL77UyB';
  const requests: string[] = [];
  page.on('request', (request) =>
    requests.push(request.url() + (request.postData() ?? '')),
  );
  await page
    .getByRole('button', { name: '添加钱包', exact: true })
    .first()
    .click();
  await page.getByLabel('保险库密码', { exact: true }).fill('test1234');
  await page.getByLabel('再次输入密码').fill('test1234');
  await page.getByRole('button', { name: '创建保险库', exact: true }).click();
  await page.getByRole('button', { name: /导入已有钱包/ }).click();
  await page.getByLabel('英文助记词').fill(mnemonic);
  const before = await page.evaluate(() =>
    localStorage.getItem('quantus.wallet.v1'),
  );
  await page.getByLabel('原钱包收款地址').fill(recipient);
  await page.getByRole('button', { name: '验证并导入', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText(
    '未匹配到原地址',
  );
  expect(
    await page.evaluate(() => localStorage.getItem('quantus.wallet.v1')),
  ).toBe(before);
  await page.getByLabel('原钱包收款地址').fill(original);
  await page.getByRole('button', { name: '验证并导入', exact: true }).click();
  await expect(
    page.getByText('已匹配原钱包地址', { exact: true }),
  ).toBeVisible();
  await expect(page.locator('.receive-address')).toHaveText(original);
  expect(
    requests.some((r) => r.includes(mnemonic) || r.includes(original)),
  ).toBe(false);
  await page
    .getByRole('button', { name: '地址一致，确认导入', exact: true })
    .click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.reload();
  await page.getByLabel('保险库密码', { exact: true }).fill('test1234');
  await page.getByRole('button', { name: '解锁', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: '收款', exact: true }).click();
  await expect(page.locator('.receive-address')).toHaveText(original);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '钱包设置' }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '下载加密备份' }).click();
  const file = testInfo.outputPath('hd65-test-backup.json');
  await (await download).saveAs(file);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.getByRole('button', { name: '从加密备份恢复' }).click();
  await page.getByLabel('选择本机加密备份').setInputFiles(file);
  await page.getByLabel('该备份的保险库密码').fill('test1234');
  await page.getByRole('button', { name: '在本机解密并恢复' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.wallet-full-address')).toHaveText(original);
});

for (const width of [1440, 390]) {
  test(`asset card stays fixed through loading, zero and error at ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    let failed = false;
    const responses = fixture as Record<string, unknown>;
    await page.route(
      /^https:\/\/rpc[12]-mainnet\.quantus\.com\//,
      async (route) => {
        await blocked;
        const request = route.request().postDataJSON();
        const key = JSON.stringify([request.method, request.params]);
        await route.fulfill({
          json: failed
            ? {
                jsonrpc: '2.0',
                id: request.id,
                error: { code: -32000, message: 'Test unavailable' },
              }
            : { jsonrpc: '2.0', id: request.id, result: responses[key] },
        });
      },
    );
    await page.route('https://sqm.quantus.com/**', (route) =>
      route.fulfill({
        json: {
          data: {
            transfer: [],
            transfer_aggregate: { aggregate: { count: 0 } },
          },
        },
      }),
    );
    await page.getByLabel('查询公开地址').fill(recipient);
    await page.getByRole('button', { name: '查询地址', exact: true }).click();
    await expect(page.locator('.balance')).toContainText('查询中');
    const measure = async () =>
      Promise.all(
        ['.balance-panel', '.balance', '.section-heading'].map((s) =>
          page.locator(s).boundingBox(),
        ),
      );
    const loading = await measure();
    release();
    await expect(page.locator('.balance')).toHaveText('0 QTC');
    expect(await measure()).toEqual(loading);
    await page.screenshot({
      path: testInfo.outputPath(`dashboard-${width}.png`),
      fullPage: true,
    });
    failed = true;
    await page.getByRole('button', { name: '刷新余额' }).click();
    await expect(page.locator('.balance')).toContainText('查询失败');
    expect(await measure()).toEqual(loading);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
  });
}

test('each wallet can be renamed or removed without changing the other wallet', async ({
  page,
}, testInfo) => {
  const phrase =
    'orchard answer curve patient visual flower maze noise retreat penalty cage small earth domain scan pitch bottom crunch theme club client swap slice raven';
  const addresses = [
    'qzoyC4eRTrexYoutXABVsf61QJZxJim3iWvayRQwEjXWgA4mw',
    'qzmTuBUzGHX7tohwjJHASSbCt64cJt6WC6j6v1SHpMTL77UyB',
  ];
  const session = await createVault('test1234');
  const raw = await seal(session, {
    selectedId: '1',
    wallets: addresses.map((address, index) => ({
      id: String(index),
      name: `账户 ${index}`,
      address,
      secret: phrase,
      type: 'mnemonic',
      derivation: 'hd65',
      accountIndex: index,
      createdAt: '',
    })),
  });
  await page.evaluate(
    (value) => localStorage.setItem('quantus.wallet.v1', value),
    raw,
  );
  await page.reload();
  const unlockPage = async () => {
    await page.getByLabel('保险库密码', { exact: true }).fill('test1234');
    await page.getByRole('button', { name: '解锁', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  };
  await unlockPage();
  await expect(page.locator('.wallet-full-address')).toHaveText(addresses);
  await expect(page.locator('.address')).toHaveText(addresses[1]);
  await page.screenshot({
    path: testInfo.outputPath('wallet-management.png'),
    fullPage: true,
  });
  await page
    .getByRole('button', { name: '管理钱包 账户 0', exact: true })
    .click();
  await page.getByRole('menuitem', { name: '重命名', exact: true }).click();
  await page.getByLabel('钱包名称', { exact: true }).fill('');
  await page.getByRole('button', { name: '保存名称', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('钱包名称不能为空');
  await page.getByLabel('钱包名称', { exact: true }).fill('我的矿工钱包');
  await page.getByRole('button', { name: '保存名称', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(
    page.getByRole('heading', { name: '账户 1', exact: true }),
  ).toBeVisible();
  await page.reload();
  await unlockPage();
  await page
    .getByRole('button', { name: '管理钱包 我的矿工钱包', exact: true })
    .click();
  await page.getByRole('menuitem', { name: '移除钱包', exact: true }).click();
  await expect(
    page.getByRole('button', { name: '确认移除', exact: true }),
  ).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(page.locator('.wallet-item')).toHaveCount(2);
  for (const name of ['我的矿工钱包', '账户 1']) {
    await page
      .getByRole('button', { name: `管理钱包 ${name}`, exact: true })
      .click();
    await page.getByRole('menuitem', { name: '移除钱包', exact: true }).click();
    await page.getByRole('checkbox', { name: '我已备份该钱包' }).check();
    await page.getByRole('button', { name: '确认移除', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    if (name === '我的矿工钱包')
      await expect(page.locator('.address')).toHaveText(addresses[1]);
  }
  await page.reload();
  await page.getByLabel('保险库密码', { exact: true }).fill('test1234');
  await page.getByRole('button', { name: '解锁', exact: true }).click();
  await expect(page.getByRole('button', { name: /创建新钱包/ })).toBeVisible();
  await expect(page.locator('.wallet-item')).toHaveCount(0);
});
