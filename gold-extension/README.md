# 金豆行情 Chrome 扩展

轻量金价监控扩展，使用 Manifest V3，行情来自已部署的 `gold-api` Cloudflare Worker。

## 功能

- 京东金融浙商积存金、Au99.99、Au(T+D)、伦敦现货黄金、纽约黄金、水贝黄金
- 弹窗每 10 秒或 30 秒刷新
- 弹窗关闭后每 30 秒后台检查
- 工具栏角标价格和涨跌颜色
- 点击行情进入近 1 小时 / 今日趋势详情
- 水贝黄金每日价格记录
- 到价提醒
- 最近 24 小时本地行情记录

## 安装

1. 解压安装包。
2. Chrome 打开 `chrome://extensions/`。
3. 开启右上角“开发者模式”。
4. 点击“加载已解压的扩展程序”。
5. 选择解压后的 `gold-bean-extension` 文件夹。
6. 将“金豆行情”固定到工具栏。

## 开发

```bash
npm install
npm run check
npm run build
npm run smoke
```

构建产物位于 `dist/`。

## 权限

- `storage`：保存设置、提醒和本地趋势数据。
- `alarms`：每 30 秒后台检查行情。
- `notifications`：发送到价提醒。
- `gold-api.961216wang.workers.dev`：获取聚合金价。

行情仅供参考，以实际交易报价为准。
