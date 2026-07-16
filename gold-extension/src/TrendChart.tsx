import { useMemo, useRef, useState } from "react";
import type { HistoryPoint } from "./types";

interface TrendChartProps {
  points: HistoryPoint[];
  period: "day" | "week";
  currentPrice: number;
  dailySampling?: boolean;
}

const WIDTH = 352;
const HEIGHT = 154;
const PADDING_X = 8;
const PADDING_TOP = 18;
const PADDING_BOTTOM = 25;
const MINUTE_MS = 60_000;

export function TrendChart({ points, period, currentPrice, dailySampling = false }: TrendChartProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const domain = useMemo(() => chartDomain(period), [period]);
  const visiblePoints = useMemo(
    () => points.filter((point) => point.time >= domain.start && point.time < domain.end),
    [domain, points],
  );

  const chart = useMemo(() => {
    if (visiblePoints.length < 2) return null;
    const prices = visiblePoints.map((point) => point.price);
    const rawMin = Math.min(...prices);
    const rawMax = Math.max(...prices);
    const span = rawMax - rawMin || Math.max(rawMax * 0.001, 0.1);
    const min = rawMin - span * 0.14;
    const max = rawMax + span * 0.14;
    const innerWidth = WIDTH - PADDING_X * 2;
    const innerHeight = HEIGHT - PADDING_TOP - PADDING_BOTTOM;
    const coordinates = visiblePoints.map((point) => ({
      x: PADDING_X + ((point.time - domain.start) / (domain.end - domain.start)) * innerWidth,
      y: PADDING_TOP + ((max - point.price) / (max - min)) * innerHeight,
      ...point,
    }));
    const maxGap = dailySampling ? 36 * 60 * MINUTE_MS : 10 * MINUTE_MS;
    const segments = coordinates.reduce<typeof coordinates[]>((groups, point) => {
      const current = groups.at(-1);
      if (!current || point.time - current.at(-1)!.time > maxGap) groups.push([point]);
      else current.push(point);
      return groups;
    }, []);
    const drawableSegments = segments.filter((segment) => segment.length > 1);
    const lines = drawableSegments.map((segment) => segment
      .map((point, index) => `${index === 0 ? "M" : "L"}${point.x.toFixed(2)},${point.y.toFixed(2)}`)
      .join(" "));
    const areas = drawableSegments.map((segment, index) => {
      const line = lines[index];
      return `${line} L${segment.at(-1)!.x},${HEIGHT - PADDING_BOTTOM} L${segment[0].x},${HEIGHT - PADDING_BOTTOM} Z`;
    });
    return { coordinates, lines, areas, min: rawMin, max: rawMax };
  }, [dailySampling, domain, visiblePoints]);

  const axisLabels = useMemo(() => makeAxisLabels(period, domain), [domain, period]);

  if (!chart) {
    return (
      <div className="chart-empty">
        <div className="chart-empty-line" />
        <strong>正在积累趋势数据</strong>
        <span>{period === "day" ? "今日每分钟保存一个价格点" : "缺失时段会保持空白"}</span>
        <span className="chart-current">当前 {formatPrice(currentPrice)}</span>
      </div>
    );
  }

  const activePoint = activeIndex === null ? null : chart.coordinates[activeIndex];

  function handlePointerMove(event: React.PointerEvent<SVGSVGElement>) {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || !chart) return;
    const x = ((event.clientX - rect.left) / rect.width) * WIDTH;
    let nearestIndex = 0;
    let nearestDistance = Number.POSITIVE_INFINITY;
    chart.coordinates.forEach((point, index) => {
      const distance = Math.abs(point.x - x);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestIndex = index;
      }
    });
    setActiveIndex(nearestIndex);
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
        <line x1="8" y1="74" x2="344" y2="74" className="chart-grid" />
        {axisLabels.map((label) => (
          <line key={label.time} x1={label.x} y1={PADDING_TOP} x2={label.x} y2={HEIGHT - PADDING_BOTTOM} className="chart-grid vertical" />
        ))}
        {chart.areas.map((area, index) => <path key={`area-${index}`} d={area} fill="url(#chartFill)" />)}
        {chart.lines.map((line, index) => <path key={`line-${index}`} d={line} className="chart-line" />)}
        {activePoint && (
          <>
            <line x1={activePoint.x} y1="10" x2={activePoint.x} y2={HEIGHT - 12} className="chart-cursor" />
            <circle cx={activePoint.x} cy={activePoint.y} r="4" className="chart-dot" />
          </>
        )}
      </svg>
      <div className={`chart-axis ${period}`}>
        {axisLabels.map((label) => (
          <span key={label.time} style={{ left: `${(label.x / WIDTH) * 100}%` }}>{label.text}</span>
        ))}
      </div>
    </div>
  );
}

function chartDomain(period: TrendChartProps["period"]): { start: number; end: number } {
  const today = startOfLocalDay(new Date());
  const start = period === "day" ? today : addDays(today, -6);
  return { start: start.getTime(), end: addDays(today, 1).getTime() };
}

function makeAxisLabels(period: TrendChartProps["period"], domain: { start: number; end: number }) {
  if (period === "day") {
    return [0, 6, 12, 18, 24].map((hour) => ({
      time: domain.start + hour * 60 * MINUTE_MS,
      x: PADDING_X + (hour / 24) * (WIDTH - PADDING_X * 2),
      text: `${String(hour).padStart(2, "0")}:00`,
    }));
  }
  return Array.from({ length: 7 }, (_, index) => {
    const date = addDays(new Date(domain.start), index);
    return {
      time: date.getTime(),
      x: PADDING_X + (index / 7) * (WIDTH - PADDING_X * 2),
      text: new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric" }).format(date),
    };
  });
}

function startOfLocalDay(date: Date): Date {
  const value = new Date(date);
  value.setHours(0, 0, 0, 0);
  return value;
}

function addDays(date: Date, days: number): Date {
  const value = new Date(date);
  value.setDate(value.getDate() + days);
  return value;
}

function formatPrice(value: number): string {
  return value >= 1_000 ? value.toFixed(1) : value.toFixed(2);
}

function formatPointTime(timestamp: number, period: TrendChartProps["period"]): string {
  return new Intl.DateTimeFormat("zh-CN", period === "week"
    ? { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }
    : { hour: "2-digit", minute: "2-digit", hour12: false })
    .format(timestamp);
}
