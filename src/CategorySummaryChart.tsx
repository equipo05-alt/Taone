import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

interface ScanRecord {
  id?: string;
  itemName?: string;
  category?: string;
  priceMinUsd?: number;
  priceMaxUsd?: number;
  scannedAt?: string;
}

interface CategoryDatum {
  category: string;
  shortCategory: string;
  count: number;
  totalMidUsd: number;
  sharePct: number;
}

interface ValueScanStorageApi {
  STORAGE_KEY?: string;
  getRecentScans: () => ScanRecord[];
}

declare global {
  interface Window {
    ValueScanStorage?: ValueScanStorageApi;
  }
}

const DAYS_WINDOW = 30;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

const BAR_PALETTE = [
  '#c5cef3', // primary-container
  '#d7c94d', // secondary
  '#ffb77f', // tertiary-fixed-dim
  '#bcc5ea', // primary-fixed-dim
  '#f4e566', // secondary-fixed
  '#ffc396', // tertiary-container
];

function truncateLabel(text: string, maxLen = 16): string {
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen - 1)}…`;
}

function buildCategorySummary(scans: ScanRecord[], days = DAYS_WINDOW): {
  data: CategoryDatum[];
  totalItems: number;
  totalValueUsd: number;
} {
  const now = Date.now();
  const cutoff = now - days * MS_PER_DAY;
  const recent = scans.filter((item) => {
    if (!item.scannedAt) return false;
    const ts = new Date(item.scannedAt).getTime();
    return !Number.isNaN(ts) && ts >= cutoff && ts <= now + 60_000;
  });

  const grouped = new Map<string, { count: number; totalMidUsd: number }>();
  let totalValueUsd = 0;

  for (const item of recent) {
    const category = (item.category || '').trim() || 'General';
    const minP = Number(item.priceMinUsd || 0);
    const maxP = Number(item.priceMaxUsd || 0);
    const mid = Math.round((minP + maxP) / 2);
    totalValueUsd += mid;

    const current = grouped.get(category) ?? { count: 0, totalMidUsd: 0 };
    current.count += 1;
    current.totalMidUsd += mid;
    grouped.set(category, current);
  }

  const totalItems = recent.length;
  const data: CategoryDatum[] = Array.from(grouped.entries())
    .map(([category, stats]) => ({
      category,
      shortCategory: truncateLabel(category, 16),
      count: stats.count,
      totalMidUsd: stats.totalMidUsd,
      sharePct: totalItems > 0 ? Math.round((stats.count / totalItems) * 100) : 0,
    }))
    .sort((a, b) => b.count - a.count || a.category.localeCompare(b.category, 'es'));

  return { data, totalItems, totalValueUsd };
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: Array<{ payload: CategoryDatum }>;
}

function CustomChartTooltip({ active, payload }: CustomTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  const item = payload[0].payload;
  const itemLabel = item.count === 1 ? 'objeto' : 'objetos';

  return (
    <div className="rounded-xl bg-surface-container-highest border border-outline-variant/60 px-3 py-2 shadow-xl text-on-surface">
      <div className="font-label-md text-label-md font-semibold text-on-surface">
        {item.category}
      </div>
      <div className="font-body-sm text-body-sm text-primary font-semibold tabular-nums mt-0.5">
        {item.count} {itemLabel} · {item.sharePct}%
      </div>
      <div className="font-label-sm text-label-sm text-on-surface-variant tabular-nums mt-0.5">
        Valor acumulado: ${item.totalMidUsd.toLocaleString('en-US')} USD
      </div>
    </div>
  );
}

interface CategorySummaryChartProps {
  interactive?: boolean;
}

function CategorySummaryChart({ interactive = false }: CategorySummaryChartProps) {
  const [scans, setScans] = useState<ScanRecord[]>(() =>
    window.ValueScanStorage ? window.ValueScanStorage.getRecentScans() : []
  );
  const [activeCategory, setActiveCategory] = useState<string>('Todas');

  useEffect(() => {
    const syncScans = () => {
      if (window.ValueScanStorage) {
        setScans(window.ValueScanStorage.getRecentScans());
      }
    };

    const handleStorage = (ev: StorageEvent) => {
      if (!ev.key || ev.key === window.ValueScanStorage?.STORAGE_KEY) {
        syncScans();
      }
    };

    const handleCategoryFilter = (ev: Event) => {
      const detail = (ev as CustomEvent<{ category?: string }>).detail;
      if (detail && typeof detail.category === 'string') {
        setActiveCategory(detail.category);
      }
    };

    window.addEventListener('valuescan:scans-updated', syncScans);
    window.addEventListener('storage', handleStorage);
    window.addEventListener('valuescan:category-filter-changed', handleCategoryFilter);

    return () => {
      window.removeEventListener('valuescan:scans-updated', syncScans);
      window.removeEventListener('storage', handleStorage);
      window.removeEventListener('valuescan:category-filter-changed', handleCategoryFilter);
    };
  }, []);

  const { data, totalItems } = useMemo(() => buildCategorySummary(scans, DAYS_WINDOW), [scans]);

  const chartHeight = useMemo(() => {
    if (data.length === 0) return 0;
    return Math.min(340, Math.max(156, data.length * 42 + 28));
  }, [data.length]);

  const handleBarSelect = (entry: CategoryDatum) => {
    if (!interactive) return;
    const nextCategory = activeCategory === entry.category ? 'Todas' : entry.category;
    setActiveCategory(nextCategory);
    window.dispatchEvent(
      new CustomEvent('valuescan:select-category', {
        detail: { category: nextCategory },
      })
    );
  };

  return (
    <div className="rounded-2xl bg-surface-container-lowest border border-outline-variant/30 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-headline-sm text-headline-sm text-on-surface font-semibold">
            Escaneos por categoría
          </h2>
          <p className="font-body-sm text-body-sm text-on-surface-variant tabular-nums mt-0.5">
            Últimos {DAYS_WINDOW} días · {totalItems} {totalItems === 1 ? 'objeto' : 'objetos'} · {data.length} {data.length === 1 ? 'categoría' : 'categorías'}
          </p>
        </div>
        {interactive && activeCategory !== 'Todas' && (
          <button
            className="px-3 py-1.5 rounded-full bg-surface-container text-primary font-label-sm text-label-sm font-semibold border border-outline-variant/40 shrink-0 whitespace-nowrap hover:bg-surface-container-high transition-colors"
            onClick={() => {
              setActiveCategory('Todas');
              window.dispatchEvent(
                new CustomEvent('valuescan:select-category', {
                  detail: { category: 'Todas' },
                })
              );
            }}
            type="button"
          >
            Ver todas
          </button>
        )}
      </div>

      {data.length === 0 ? (
        <div className="mt-4 py-6 px-4 rounded-xl bg-surface-container/60 border border-outline-variant/20 text-center flex flex-col items-center">
          <span className="material-symbols-outlined text-[28px] text-primary mb-2">
            bar_chart
          </span>
          <p className="font-body-sm text-body-sm text-on-surface-variant max-w-xs">
            Aún no hay escaneos en los últimos 30 días. Escanea un objeto para ver tu distribución por categoría.
          </p>
          <a
            className="mt-3 h-10 px-5 rounded-full bg-primary-container text-on-primary font-label-md text-label-md font-semibold inline-flex items-center gap-1.5 active:scale-95 transition-transform"
            href="/escanear"
          >
            <span className="material-symbols-outlined text-[18px]">photo_camera</span>
            <span>Escanear objeto</span>
          </a>
        </div>
      ) : (
        <>
          <div className="mt-3 w-full" style={{ height: `${chartHeight}px` }}>
            <ResponsiveContainer height="100%" width="100%">
              <BarChart
                data={data}
                layout="vertical"
                margin={{ top: 6, right: 20, left: 0, bottom: 2 }}
              >
                <CartesianGrid
                  horizontal={false}
                  stroke="#4c463c"
                  strokeDasharray="3 3"
                  strokeOpacity={0.45}
                />
                <XAxis
                  allowDecimals={false}
                  axisLine={{ stroke: '#4c463c' }}
                  tick={{ fill: '#cec5b8', fontSize: 11 }}
                  tickLine={false}
                  type="number"
                />
                <YAxis
                  axisLine={false}
                  dataKey="shortCategory"
                  tick={{ fill: '#f5e0b8', fontSize: 12, fontWeight: 500 }}
                  tickLine={false}
                  type="category"
                  width={112}
                />
                <Tooltip
                  content={<CustomChartTooltip />}
                  cursor={{ fill: '#34280e', fillOpacity: 0.45 }}
                />
                <Bar
                  animationDuration={180}
                  barSize={20}
                  className={interactive ? 'cursor-pointer' : undefined}
                  dataKey="count"
                  onClick={(_barData, index) => {
                    if (typeof index === 'number' && data[index]) {
                      handleBarSelect(data[index]);
                    }
                  }}
                  radius={[0, 6, 6, 0]}
                >
                  {data.map((entry, idx) => {
                    const isSelected =
                      !interactive ||
                      activeCategory === 'Todas' ||
                      activeCategory === entry.category;
                    return (
                      <Cell
                        fill={BAR_PALETTE[idx % BAR_PALETTE.length]}
                        fillOpacity={isSelected ? 1 : 0.35}
                        key={entry.category}
                      />
                    );
                  })}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          {interactive && (
            <p className="font-label-sm text-label-sm text-on-surface-variant mt-2">
              Toca una barra para filtrar el historial por categoría.
            </p>
          )}
        </>
      )}
    </div>
  );
}

function mountChart() {
  const container = document.getElementById('valuescanCategoryChart');
  if (!container) return;
  const interactive = container.dataset.interactive === 'true';
  const root = createRoot(container);
  root.render(<CategorySummaryChart interactive={interactive} />);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mountChart);
} else {
  mountChart();
}
