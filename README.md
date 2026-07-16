# Gold API Worker

Cloudflare Worker that aggregates:

- 京东金融浙商积存金
- 京东金融民生积存金
- Au99.99
- 伦敦现货黄金
- 纽约黄金
- 水贝黄金
- 门店黄金（8 家代表门店中位数）
- 银行投资金条（5 家代表银行中位数）
- 黄金回收

## Endpoints

- Production base URL: `https://gold-api.pixidou.com`
- `GET /v1/quotes` — aggregated quotes
- `GET /v1/quotes?refresh=1` — bypass the 5-second fresh cache
- `GET /health` — health check

The Worker keeps a 5-second edge cache and a 5-minute last-known-good fallback.

## Development

```bash
npm install
npm run types
npm run check
npm run dev
```

## Deploy

```bash
npx wrangler login
npm run deploy
```
