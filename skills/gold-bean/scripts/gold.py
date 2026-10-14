#!/usr/bin/env python3
"""Read-only gold API queries and stateless Decimal calculations (Python stdlib)."""
import argparse
import json
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone
from decimal import Decimal, DecimalException, InvalidOperation, localcontext

API_URL = "https://gold-api.pixidou.com/v1/quotes"
OUNCE_GRAMS = Decimal("31.1034768")
MAX_BYTES = 1_048_576


class GoldError(Exception):
    pass


class JsonArgumentParser(argparse.ArgumentParser):
    def error(self, message):
        raise GoldError(message)


def number(value, label, zero=False):
    if value is None or isinstance(value, bool):
        raise GoldError(f"Invalid number: {label}")
    try:
        n = Decimal(str(value))
    except (InvalidOperation, ValueError, TypeError):
        raise GoldError(f"Invalid number: {label}") from None
    if not n.is_finite() or n < 0 or (n == 0 and not zero):
        raise GoldError(f"{label} must be finite and {'>= 0' if zero else '> 0'}")
    return n


def fetch_snapshot():
    request = urllib.request.Request(API_URL, headers={"Accept": "application/json", "User-Agent": "gold-bean-skill/1.0"})
    try:
        with urllib.request.urlopen(request, timeout=35) as response:
            raw = response.read(MAX_BYTES + 1)
        if len(raw) > MAX_BYTES:
            raise GoldError("API response too large")
        payload = json.loads(raw, parse_float=Decimal)
    except urllib.error.HTTPError as exc:
        raise GoldError(f"Quote API returned HTTP {exc.code}; no quote data obtained") from None
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        raise GoldError(f"Quote API unavailable: {exc}") from None
    except (ValueError, UnicodeError):
        raise GoldError("Quote API returned invalid JSON") from None
    if not isinstance(payload, dict) or payload.get("success") is not True:
        raise GoldError("Quote API did not report success")
    quotes = payload.get("quotes")
    if not isinstance(quotes, list) or not quotes:
        raise GoldError("Quote API has no quotes")
    if any(not isinstance(q, dict) or not isinstance(q.get("id"), str) for q in quotes):
        raise GoldError("Quote API has invalid quote records")
    if len({q['id'] for q in quotes}) != len(quotes):
        raise GoldError("Quote API returned duplicate quote IDs")
    for q in quotes:
        number(q.get("price"), f"{q['id']}.price")
        if not isinstance(q.get("unit"), str) or not q["unit"]:
            raise GoldError(f"Missing unit for {q['id']}")
    return payload


def timestamp(value):
    try:
        n = number(value, "timestamp")
        if n < Decimal("1000000000000"):
            return None
        return datetime.fromtimestamp(float(n / 1000), timezone.utc).isoformat()
    except (GoldError, ValueError, OverflowError, OSError):
        return None


def metadata(payload, quotes):
    warnings = []
    if payload.get("stale"):
        warnings.append("Fallback data used; see stale_sources")
    sources = payload.get("sources", {})
    if not isinstance(sources, dict):
        sources = {}
    failed = [k for k, v in sources.items() if isinstance(v, dict) and v.get("ok") is not True]
    if failed:
        warnings.append("Failed or unavailable sources: " + ", ".join(failed))
    now = datetime.now(timezone.utc)
    timed = [(q['id'], q.get("sourceTime")) for q in quotes]
    rates = payload.get("exchangeRates")
    if isinstance(rates, dict):
        timed.append(("exchangeRate", rates.get("sourceTime")))
    for label, value in timed:
        t = timestamp(value)
        if t is None:
            warnings.append(f"{label}: source time unknown or invalid")
        else:
            age = (now - datetime.fromisoformat(t)).total_seconds()
            if age > 900:
                warnings.append(f"{label}: source is over 15 minutes old; cause not determined")
            elif age < -300:
                warnings.append(f"{label}: source time is in the future")
    return {"api_url": API_URL, "fetched_at": payload.get("fetchedAt"),
            "fetched_at_utc": timestamp(payload.get("fetchedAt")), "stale": payload.get("stale"),
            "stale_sources": payload.get("staleSources", []), "sources": sources, "warnings": warnings}


def select_quotes(payload, ids):
    if not ids:
        return payload["quotes"]
    by_id = {q["id"]: q for q in payload["quotes"]}
    missing = [i for i in ids if i not in by_id]
    if missing:
        raise GoldError("Quotes unavailable: " + ", ".join(missing) + "; returned IDs: " + ", ".join(by_id))
    return [by_id[i] for i in dict.fromkeys(ids)]


def exchange_rate(payload, manual=None):
    if manual is not None:
        return number(manual, "usd_cny"), {"rate_source": "manual", "source_time": None}
    rates = payload.get("exchangeRates")
    if not isinstance(rates, dict) or rates.get("usdCny") is None:
        raise GoldError("API USD/CNY rate unavailable; supply --usd-cny for conversion")
    return number(rates["usdCny"], "exchangeRates.usdCny"), {
        "rate_source": "api", "source_time": rates.get("sourceTime"),
        "source_time_utc": timestamp(rates.get("sourceTime")),
        "fallback": "exchangeRate" in (payload.get("staleSources") or [])}


def conversion(payload, direction, value, manual=None):
    price = number(value, "value")
    fx, fx_meta = exchange_rate(payload, manual)
    result = price * fx / OUNCE_GRAMS if direction == "usd-per-oz" else price * OUNCE_GRAMS / fx
    return {"input": price, "input_unit": direction, "result": result,
            "result_unit": "cny-per-g" if direction == "usd-per-oz" else "usd-per-oz",
            "usd_cny": fx, "exchange_rate": fx_meta, "troy_ounce_grams": OUNCE_GRAMS,
            "basis": "Theoretical unit/FX conversion; excludes product premiums, spread and fees"}


def cny_per_gram(payload, quote):
    unit = quote["unit"].strip().lower().replace(" ", "")
    price = number(quote["price"], "quote.price")
    if unit in {"元/克", "人民币/克", "人民币元/克", "cny/g", "rmb/g", "cny/克", "¥/克", "￥/克"}:
        return price, None
    if unit in {"美元/盎司", "美元/金衡盎司", "美金/盎司", "usd/oz", "usd/ozt", "$/oz", "美元/oz"}:
        fx, meta = exchange_rate(payload)
        return price * fx / OUNCE_GRAMS, {"usd_cny": fx, **meta}
    raise GoldError(f"Unsupported valuation unit for {quote['id']}: {quote['unit']}")


def validate_positions(inputs):
    if not isinstance(inputs, list) or not inputs or len(inputs) > 100:
        raise GoldError("positions must be a nonempty list of at most 100 items")
    for item in inputs:
        if not isinstance(item, dict) or not isinstance(item.get("quote_id"), str) or not item["quote_id"]:
            raise GoldError("Each position requires quote_id, grams, cost_price")
        number(item.get("grams"), "grams")
        number(item.get("cost_price"), "cost_price", zero=True)


def positions(payload, inputs):
    validate_positions(inputs)
    output = []
    for item in inputs:
        grams = number(item["grams"], "grams")
        cost_price = number(item["cost_price"], "cost_price", zero=True)
        quote = select_quotes(payload, [item["quote_id"]])[0]
        price, fx_meta = cny_per_gram(payload, quote)
        cost, value = grams * cost_price, grams * price
        output.append({"quote_id": quote["id"], "name": quote.get("name"), "grams": grams,
                       "cost_price_cny_per_g": cost_price, "reference_price_cny_per_g": price,
                       "cost_cny": cost, "reference_value_cny": value,
                       "unrealized_profit_cny": value - cost,
                       "return_percent": (value - cost) / cost * 100 if cost else None,
                       "quote_price": quote["price"], "quote_unit": quote["unit"],
                       "source_time": quote.get("sourceTime"), "exchange_rate": fx_meta})
    cost = sum((p["cost_cny"] for p in output), Decimal(0))
    value = sum((p["reference_value_cny"] for p in output), Decimal(0))
    return {"positions": output, "totals": {"cost_cny": cost, "reference_value_cny": value,
            "unrealized_profit_cny": value - cost, "return_percent": (value - cost) / cost * 100 if cost else None},
            "basis": "API price reference valuation; excludes fees and execution spread; not realized profit"}


def parser():
    p = JsonArgumentParser(description=__doc__)
    sub = p.add_subparsers(dest="command", required=True)
    q = sub.add_parser("quotes", help="Read current quotes")
    q.add_argument("--quote", action="append")
    c = sub.add_parser("convert", help="Convert theoretical gold unit/FX price")
    c.add_argument("--from", dest="direction", choices=["usd-per-oz", "cny-per-g"], required=True)
    c.add_argument("--value", required=True)
    c.add_argument("--usd-cny", help="Explicit manual RMB per USD rate")
    h = sub.add_parser("position", help="Value positions supplied with this call")
    h.add_argument("--quote")
    h.add_argument("--grams")
    h.add_argument("--cost-price")
    h.add_argument("--positions-json", help="JSON list: quote_id, grams, cost_price (RMB/g)")
    return p


def json_default(value):
    if isinstance(value, Decimal):
        return format(value, "f")
    raise TypeError(f"Cannot serialize {type(value).__name__}")


def main(argv=None):
    try:
        args = parser().parse_args(argv)
        with localcontext() as context:
            context.prec = 28
            inputs = None
            if args.command == "convert":
                number(args.value, "value")
                if args.usd_cny is not None:
                    number(args.usd_cny, "usd_cny")
            if args.command == "position":
                if args.positions_json is not None:
                    if any(v is not None for v in [args.quote, args.grams, args.cost_price]):
                        raise GoldError("Use either --positions-json or single-position arguments")
                    try:
                        inputs = json.loads(args.positions_json, parse_float=Decimal)
                    except ValueError:
                        raise GoldError("Invalid --positions-json") from None
                else:
                    if any(v is None for v in [args.quote, args.grams, args.cost_price]):
                        raise GoldError("Supply --quote, --grams and --cost-price")
                    inputs = [{"quote_id": args.quote, "grams": args.grams, "cost_price": args.cost_price}]
                validate_positions(inputs)
            payload = fetch_snapshot()
            if args.command == "quotes":
                selected = select_quotes(payload, args.quote)
                result = {"quotes": selected, "exchange_rates": payload.get("exchangeRates")}
            elif args.command == "convert":
                selected = []
                result = conversion(payload, args.direction, args.value, args.usd_cny)
            else:
                selected = select_quotes(payload, [i["quote_id"] for i in inputs])
                result = positions(payload, inputs)
            print(json.dumps({"success": True, "command": args.command, **result,
                              "data_status": metadata(payload, selected)}, ensure_ascii=False, default=json_default))
        return 0
    except GoldError as exc:
        print(json.dumps({"success": False, "error": str(exc), "api_url": API_URL}, ensure_ascii=False))
        return 2
    except DecimalException:
        print(json.dumps({"success": False, "error": "Calculation exceeds supported numeric precision", "api_url": API_URL}))
        return 2


if __name__ == "__main__":
    sys.exit(main())
