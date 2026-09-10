# Quantus 本地 Web 钱包

网页：<https://minerx-vip.github.io/quantus-wallet/>

社区开发的 Quantus 主网静态钱包，可部署在 GitHub Pages。没有钱包后端、登录服务或统计脚本。

## 功能

- 多钱包创建、导入、切换、重命名、移除。
- 浏览器生成 24 个英文助记词，备份后抽查 3 个单词再保存。
- 支持有效 BIP39 英文助记词和 **32 字节私钥种子**（64 位十六进制，可带 `0x`）。不支持直接导入 4896 字节展开私钥。
- 普通 ML-DSA-65 / ML-DSA-87 账户，HD 路径分别为 `m/44'/189189'/account'/0'/1'` 和 `m/44'/189189'/account'/0'/0'`。
- 查询余额、转入/转出及系统入账，分页，时区 UTC−12 至 UTC+14，默认 UTC+8。
- 本地签名、手续费预览、用户确认后广播 `balances.transferKeepAlive`。
- AES-256-GCM 本地保险库（密码至少 8 位）、加密文件备份与恢复、闲置 5 分钟自动锁定。

**Wormhole 挖矿奖励账户使用不同派生路径和证明机制，本版本不支持其生成或支出。** 可以查询公开地址，但不要将普通账户误当作 Wormhole 奖励账户。交易历史受官方索引覆盖和同步延迟影响，广播成功不等于交易执行成功。

## 安全声明

1. 本程序按现状提供，未经独立安全审计。使用风险与资产损失由用户自行承担。请离线备份助记词并核对完整收款地址。
2. 连接 [Quantus 官方主网 RPC](https://rpc1-mainnet.quantus.com)（连接失败时自动切换到 [第二官方节点](https://rpc2-mainnet.quantus.com)） 和 [官方交易索引](https://sqm.quantus.com/v1/graphql)，不使用开发者自己的节点。查询会向官方服务发送公开地址，服务也能看到客户端 IP；助记词、私钥和保险库密码不会上传。
3. 程序完全开源，可审查代码和自行部署。开源不等于已经安全审计。

钱包名称、地址、助记词/种子统一加密后存入当前浏览器的 `localStorage`，使用 PBKDF2-SHA256（600,000 次、随机 16 字节盐）派生不可导出的 AES-256-GCM 密钥，每次保存生成新 12 字节 IV。时区偏好单独保存。刷新或重新打开页面后会显示解锁窗口，输入密码即可恢复原钱包列表，不需要重新导入。解锁期间密钥和钱包内容留在浏览器内存中；恶意扩展或受控设备仍可能窃取资料。

清除站点数据、换浏览器、换设备或换站点域名不会自动迁移钱包。请先下载加密备份并保存保险库密码；密码无法找回。GitHub Pages 同一用户域名下的其他项目共享同源存储边界，建议只在该域名部署可信代码；正式独立运营可使用专属域名。

手续费查询使用被清零的无效签名，仅在点击确认后发送可执行的签名交易。主网创世哈希固定为 `0xfb5487c0be6ae4ade2d41d16e50465129861636c2b8d61fa94d7a19631626fba`；当前仅允许 runtime spec 152 / transaction version 6 转账，升级时停止签名，需重新核验兼容性。

## 开发与验证

需要 Node.js 22.13 或更新版本。

```sh
npm ci
npm run dev
npm run typecheck
npm test
PAGES_BASE_PATH=/quantus-wallet npm run build
# 首次浏览器测试需安装 Chromium（macOS 默认使用已安装的 Chrome）
npx playwright install chromium
npm run test:browser
```

纯静态产物为 `dist/pages`。GitHub 仓库 Settings → Pages → Source 选择 GitHub Actions；推送 `main` 自动测试、构建并部署。根域部署时不设置 `PAGES_BASE_PATH`。

`tests/live-smoke.ts` 可通过 `node --import tsx tests/live-smoke.ts` 查询官方节点，并用公开测试种子的无效签名估算费用，**不广播交易**。没有使用真实资金做转账测试。

## 密码学来源与可重建性

`crypto/` 基于 MIT 许可的 [Quantus 官方 quantus-wasm](https://github.com/Quantus-Network/quantus-wasm)，保留原始许可。使用 `qp-rusty-crystals-dilithium` / `hdwallet` 4.1.1，并按[官方 CLI](https://github.com/Quantus-Network/quantus-cli)主网规则加入 `QUANTUS_EXTRINSIC` 签名上下文。Rust 测试覆盖地址与链上 crate 一致性、SCALE 编码、签名向量、主网上下文绑定与篡改拒绝。

预编译浏览器 WASM 位于 `crypto/pkg`，Pages 构建直接打包该文件。重新生成：

```sh
rustup toolchain install 1.93.0
rustup target add wasm32-unknown-unknown --toolchain 1.93.0
cargo +1.93.0 test --manifest-path crypto/Cargo.toml --locked
cargo +1.93.0 build --release --target wasm32-unknown-unknown --manifest-path crypto/Cargo.toml --locked
cargo install wasm-bindgen-cli --version 0.2.125 --locked
wasm-bindgen crypto/target/wasm32-unknown-unknown/release/quantus_wasm.wasm --out-dir crypto/pkg --target web
```

本项目采用 MIT 许可，详见 `LICENSE`；上游密码学代码另见 `crypto/LICENSE`。


### 与官方手机钱包恢复同一地址

助记词导入支持官方手机钱包的 HD ML-DSA-65（路径末位 1′）、HD ML-DSA-87（末位 0′）以及早期非 HD ML-DSA-87。填写原钱包公开收款地址后，网页会在本机匹配两种 HD 类型的 0–19 及指定账户序号，再核对早期非 HD 类型；不会发送助记词或候选地址。未匹配时不保存，匹配后仍需确认完整地址。

已保存的钱包没有新类型字段时仍按原来的 HD ML-DSA-87 恢复，不会自动更换地址。账户类型加密保存并用于后续签名；备份恢复后保持不变。暂不支持 BIP39 附加密码、自定义完整派生路径或 Wormhole 支出。

兼容性向量来自[官方手机钱包测试](https://github.com/Quantus-Network/quantus-apps/blob/76df7b06d7a092c9cdfb9a459f8effb9ddb5e737/quantus_sdk/test/generate_keys_test.dart)，覆盖两种 HD 类型的账户 0 / 1 与早期非 HD 地址。
