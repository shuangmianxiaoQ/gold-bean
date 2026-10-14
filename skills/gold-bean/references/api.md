# 接口与计算口径

## 唯一上游

`GET https://gold-api.pixidou.com/v1/quotes`，无需认证；默认行情缓存 10 秒，异常来源可能用 5 分钟备用结果，汇率单独缓存 15 分钟。只读，不请求历史或写入接口。

| ID | 含义 | 通常单位 |
|---|---|---|
| jd_zs_accumulation | 京东金融浙商积存金 | 元/克 |
| jd_ms_accumulation | 京东金融民生积存金 | 元/克 |
| au9999 | Au99.99 | 元/克 |
| london_gold | 伦敦现货黄金 | 美元/盎司 |
| new_york_gold | 纽约黄金 | 美元/盎司 |
| shuibei_gold | 水贝黄金 | 元/克 |
| retail_store_gold | 门店黄金代表样本中位数 | 元/克 |
| bank_investment_bar | 银行金条代表样本中位数 | 元/克 |
| gold_recycle | 黄金回收参考价 | 元/克 |

以实际 `unit` 为准；接口可能返回部分品种，没有支付宝积存金或 Au(T+D) 独立报价。

## 字段

- `success`：至少一项行情成功，不等于全部来源成功。
- `fetchedAt`：抓取时间，Unix 毫秒，不是源报价时间。
- `stale`、`staleSources`：备用数据使用状态。
- `quotes[]`：`id`、`name`、`category`、`price`、`unit`；可选 `sellPrice`、`yesterdayPrice`、`changeAmount`、`changePercent`、`high`、`low`、`sourceTime`。
- `aggregation`：可选，`method=median`；含 `sampleCount`、`min`、`max`、`samples[{name,price}]`。
- `sources`：`jdZheshang`、`jdMinsheng`、`market`、`exchangeRate` 的 `ok`、可选时间和错误。
- `exchangeRates.usdCny`：1 美元对应的人民币数量；`sourceTime` 是汇率源时间。

脚本将 Decimal 数值输出为十进制字符串。warnings 中的旧报价仅是时间差观察，不代表已确定故障或休市。

## 公式

O = 31.1034768 克/金衡盎司，F = 人民币/美元。

- 美元/盎司 → 人民币/克：P × F ÷ O；逆向：P × O ÷ F。
- 单项输入：`quote_id`、`grams`（> 0）、`cost_price`（>= 0，人民币/克）。
- 成本 = grams × cost_price。
- 参考市值 = grams × 当前人民币/克报价。
- 浮动盈亏 = 参考市值 − 成本。
- 收益率 = 浮动盈亏 ÷ 成本 × 100%；成本为 0 则 null。
- 多项只合计成本、市值和浮盈，不计算不同产品间平均克价。

不含溢价预测、手续费和可执行买卖价差；不是已实现盈亏，不跟踪历史买卖，不保存持仓。国际持仓折算使用同一请求的汇率。
