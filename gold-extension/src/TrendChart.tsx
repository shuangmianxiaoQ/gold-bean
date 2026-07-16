import { useMemo, useRef, useState } from "react";
import type { HistoryPoint } from "./types";

interface TrendChartProps {
  points: HistoryPoint[];
  period: "hour" | "day" | "week";
  currentPrice: number;
}

const WIDTH = 352;
const HEIGHT = 154;
const PADDING_X = 8;
const PADDING_Y = 18;

export function TrendChart({ points, period, currentPrice }: TrendChartProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const visiblePoints = useMemo(() => {
    const cutoff = Date.now() - (period === "hour" ? 60 * 60_000 : period === "day" ? 24 * 60 * 60_000 : 7 * 24 * 60 * 60_000);
    return points.filter((point) => point.time >= cutoff);
  }, [points, period]);

  const chart = useMemo(() => {
    const data = visiblePoints.length > 0 ? visiblePoints : [];
    if (data.length < 2) return null;
    const prices = data.map((point) => point.price);
    const rawMin = Math.min(...prices);
    const rawMax = Math.max(...prices);
    const span = rawMax - rawMin || Math.max(rawMax * 0.001, 0.1);
    const min = rawMin - span * 0.14;
    const max = rawMax + span * 0.14;
    const innerWidth = WIDTH - PADDING_X * 2;
    const innerHeight = HEIGHT - PADDING_Y * 2;
    const coordinates = data.map((point, index) => ({
      x: PADDING_X + (index / (data.length - 1)) * innerWidth,
      y: PADDING_Y + ((max - point.price) / (max - min)) * innerHeight,
      ...point,
    }));
    const line = coordinates.map((point, index) => `${index === 0 ? "M" : "L"}${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(" ");
    const area = `${line} L${coordinates.at(-1)!.x},${HEIGHT - PADDING_Y} L${coordinates[0].x},${HEIGHT - PADDING_Y} Z`;
    return { coordinates, line, area, min: rawMin, max: rawMax };
  }, [visiblePoints]);

  if (!chart) {
    return (
      <div className="chart-empty">
        <div className="chart-empty-line" />
        <strong>正在积累趋势数据</strong>
        <span>插件每分钟保存一个价格点</span>
        <span className="chart-current">当前 {formatPrice(currentPrice)}</span>
      </div>
    );
  }

  const activePoint = activeIndex === null ? null : chart.coordinates[activeIndex];

  function handlePointerMove(event: React.PointerEvent<SVGSVGElement>) {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || !chart) return;
    const x = ((event.clientX - rect.left) / rect.width) * WIDTH;
    const ratio = Math.max(0, Math.min(1, (x - PADDING_X) / (WIDTH - PADDING_X * 2)));
    setActiveIndex(Math.round(ratio * (chart.coordinates.length - 1)));
  }

  return (
    <div className="chart-wrap">
      <div className="chart-scale chart-scale-top">{formatPrice(chart.max)}</div>
      <div className="chart-scale chart-scale-bottom">{formatPrice(chart.min)}</div>
      {activePoint && (
        <div className="chart-tooltip" style={{ left: `${(activePoint.x / WIDTH) * 100}%` }}>
          <strong>{formatPrice(activePoint.price)}</strong>
          <span>{formatPointTime(activePoint.time, period)}</span>
        </div>
      )}
      <svg
        ref={svgRef}
        className="trend-chart"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label="价格趋势图"
        onPointerMove={handlePointerMove}
        onPointerLeave={() => setActiveIndex(null)}
      >
        <defs>
          <linearGradient id="chartFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#D8A84E" stopOpacity="0.3" />
            <stop offset="100%" stopColor="#D8A84E" stopOpacity="0" />
          </linearGradient>
        </defs>
        <line x1="8" y1="77" x2="344" y2="77" className="chart-grid" />
        <path d={chart.area} fill="url(#chartFill)" />
        <path d={chart.line} className="chart-line" />
        {activePoint && (
          <>
            <line x1={activePoint.x} y1="10" x2={activePoint.x} y2="142" className="chart-cursor" />
            <circle cx={activePoint.x} cy={activePoint.y} r="4" className="chart-dot" />
          </>
        )}
      </svg>
    </div>
  );
}

function formatPrice(value: number): string {
  return value >= 1_000 ? value.toFixed(1) : value.toFixed(2);
}

function formatPointTime(timestamp: number, period: TrendChartProps["period"]): string {
  return new Intl.DateTimeFormat("zh-CN", period === "week"
    ? { month: "numeric", day: "numeric" }
    : { hour: "2-digit", minute: "2-digit", hour12: false })
    .format(timestamp);
}
