---
name: gold-bean
description: 通过 gold-api.pixidou.com 公开实时行情接口查询浙商/民生积存金、Au99.99、伦敦金、纽约金、水贝、门店、银行金条、回收参考价和美元兑人民币汇率，进行黄金单位与汇率换算，以及按调用者传入的克数和成本价测算持仓参考市值与浮动盈亏。在询问当前金价、积存金报价、美元每盎司与人民币每克换算、黄金持仓盈亏时使用。不提供历史查询、账户连接、交易执行或持续盯盘。
---

# 金豆行情

使用 Python 3 标准库脚本 `scripts/gold.py`；将 `<skill-dir>` 替换为本技能实际目录。每次调用仅读取 `https://gold-api.pixidou.com/v1/quotes`；无需 API Key、MCP、Cloudflare 登录或浏览器扩展。

## 查询实时行情

```bash
python <skill-dir>/scripts/gold.py quotes
python <skill-dir>/scripts/gold.py quotes --quote jd_zs_accumulation --quote london_gold
```

按 `references/api.md` 映射名称到行情 ID。读取价格、单位、源报价时间、抓取时间、来源状态和 warnings；按用户需要输出简洁表格。

## 单位与汇率换算

```bash
python <skill-dir>/scripts/gold.py convert --from usd-per-oz --value 4000
python <skill-dir>/scripts/gold.py convert --from cny-per-g --value 900
python <skill-dir>/scripts/gold.py convert --from usd-per-oz --value 4000 --usd-cny 7.1
```

默认读取接口汇率；仅当用户提供汇率时使用 `--usd-cny` 并标注手动汇率。两种方向都读取行情接口以保留本次来源状态。

使用 1 金衡盎司 = 31.1034768 克；美元/盎司 × 美元兑人民币 ÷ 31.1034768 = 人民币/克，反向使用逆运算。将结果标为理论折算价，不推算具体产品成交价，不使用插件里的产品价差模型。缺少接口汇率时补问用户汇率，不猜测。

## 持仓测算

用调用时传入的行情 ID、克数、平均成本价计算参考市值、成本、浮动盈亏和收益率；成本价单位固定为人民币/克。

```bash
python <skill-dir>/scripts/gold.py position --quote jd_zs_accumulation --grams 10 --cost-price 915
python <skill-dir>/scripts/gold.py position --positions-json '[{"quote_id":"jd_zs_accumulation","grams":10,"cost_price":915},{"quote_id":"au9999","grams":5,"cost_price":880}]'
```

使用接口 `price` 作为参考估值；美元/盎司报价先用接口汇率折算人民币/克。只计算毛浮盈，不描述为实际卖出所得或已实现利润。用户给出多笔买入时可先计算加权平均成本；含卖出记录且未明确剩余持仓成本时，询问剩余克数和成本口径，不套用记账规则。

不读取身份、Chrome 数据、账户或过去对话中的持仓，不保存输入。未提供品种、克数或成本时仅补问缺少的参数。

## 数据与执行规则

- 按需调用；不轮询、不创建定时任务、不调用历史接口、不写入 D1。
- 使用接口默认缓存，不使用 `refresh=1`；一次计算只请求一份快照，多项持仓共用快照。
- 以实际返回品种为准；缺失品种、汇率或不支持单位时报告缺失，不用其他品种代替。
- 区分 `fetchedAt` 与 `sourceTime`。`stale=false` 只表示未使用失败来源的备用值，不保证报价时间最新。保留旧报价、未知源时间和失败来源提示。
- 不依据时间差单独断定休市或接口故障。门店、银行报价是代表样本中位数，回收、水贝是参考价；样本区间以接口实际返回值为准。
- 脚本成功输出 JSON、退出 0；失败输出结构化错误、退出 2。遇到网络限制、403 或上游失败，说明本次无法取得数据，不用训练记忆填充价格或汇率。
- 输出先给所需数值，价格通常保留两位小数；补充必要单位、报价时间和参考口径，不展开全部原始 JSON。

字段、ID 与公式详情见 `references/api.md`。
