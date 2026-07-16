# 金豆行情（Gold Bean）

个人使用的 Chrome 金价监控扩展，以及为扩展提供统一行情数据的 Cloudflare Worker。

## 功能

- 关注京东金融浙商/民生积存金、Au99.99、伦敦现货黄金、纽约黄金和水贝黄金
- 展示门店黄金、银行投资金条与黄金回收参考价
- 弹窗每 10 秒或 30 秒刷新，关闭弹窗后每 30 秒后台检查
- 工具栏角标、近 1 小时/今日趋势、到价提醒
- 记录浙商、民生和支付宝积存金交易，计算持仓、成本与收益
- 使用 Chrome Sync 同步设置、持仓和提醒
- 支持 JSON 数据导出、合并导入和覆盖恢复

## 项目结构

```text
.
├── src/                 # Cloudflare Worker
├── scripts/             # Worker 冒烟测试
└── gold-extension/      # Chrome 扩展（Manifest V3）
```

## 行情接口

生产地址：`https://gold-api.pixidou.com`

- `GET /v1/quotes`：聚合行情
- `GET /v1/quotes?refresh=1`：跳过 5 秒新鲜缓存
- `GET /health`：健康检查

Worker 使用 5 秒边缘缓存，并保留 5 分钟最近一次成功结果作为上游异常时的降级数据。

## 本地开发

### Cloudflare Worker

```bash
npm install
npm run check
npm run smoke
npm run dev
```

### Chrome 扩展

```bash
cd gold-extension
npm install
npm run check
npm run build
npm run smoke
```

构建完成后，在 `chrome://extensions/` 开启开发者模式，选择“加载已解压的扩展程序”，加载 `gold-extension/dist`。

## 数据与隐私

持仓、提醒和设置保存在浏览器本地，并可由 Chrome Sync 在已登录的 Chrome 设备间同步；项目没有自建用户数据库。行情和测算结果仅供参考，请以实际交易报价为准。
