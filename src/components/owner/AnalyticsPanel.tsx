import React, { useMemo, useState } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { BarChart3, ExternalLink } from 'lucide-react';
import { Order, Shop } from '../../types';
import { formatCurrency } from '../../lib/validation';

interface AnalyticsPanelProps {
  shop: Shop;
  orders: Order[];
  loading: boolean;
  onOpenStorefront: () => void;
}

type Timeframe = 'today' | '7d' | '30d' | 'all';

function getOrderDate(order: Order): Date {
  if (order.created_at && typeof order.created_at.toDate === 'function') {
    return order.created_at.toDate();
  }
  return new Date();
}

export const AnalyticsPanel: React.FC<AnalyticsPanelProps> = ({
  shop,
  orders,
  loading,
  onOpenStorefront,
}) => {
  const [timeframe, setTimeframe] = useState<Timeframe>('30d');
  const accent = shop.primary_color || '#2563EB';

  const filteredOrders = useMemo(() => {
    if (timeframe === 'all') return orders;
    const now = new Date();
    const cutoff = new Date(now);
    if (timeframe === 'today') {
      cutoff.setHours(0, 0, 0, 0);
    } else if (timeframe === '7d') {
      cutoff.setDate(now.getDate() - 7);
    } else {
      cutoff.setDate(now.getDate() - 30);
    }
    return orders.filter((o) => getOrderDate(o) >= cutoff);
  }, [orders, timeframe]);

  const kpis = useMemo(() => {
    const totalOrders = filteredOrders.length;
    const totalRevenue = filteredOrders.reduce((sum, o) => sum + (Number(o.total_amount) || 0), 0);
    const avgOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;
    const completedCount = filteredOrders.filter(
      (o) => o.status === 'served' || o.status === 'paid'
    ).length;
    const paidCount = filteredOrders.filter((o) => o.status === 'paid').length;
    const completionRate = totalOrders > 0 ? Math.round((completedCount / totalOrders) * 100) : 0;
    return { totalOrders, totalRevenue, avgOrderValue, completedCount, paidCount, completionRate };
  }, [filteredOrders]);

  const revenueTrend = useMemo(() => {
    const bucketMap = new Map<string, { label: string; revenue: number; orders: number; sortKey: number }>();

    filteredOrders.forEach((order) => {
      const dt = getOrderDate(order);
      let key: string;
      let label: string;
      let sortKey: number;

      if (timeframe === 'today') {
        const hour = dt.getHours();
        key = `h-${hour}`;
        label = `${hour.toString().padStart(2, '0')}:00`;
        sortKey = hour;
      } else {
        key = `${dt.getFullYear()}-${dt.getMonth() + 1}-${dt.getDate()}`;
        label = dt.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
        sortKey = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate()).getTime();
      }

      const existing = bucketMap.get(key) || { label, revenue: 0, orders: 0, sortKey };
      existing.revenue = Math.round((existing.revenue + (Number(order.total_amount) || 0)) * 100) / 100;
      existing.orders += 1;
      bucketMap.set(key, existing);
    });

    return Array.from(bucketMap.values())
      .sort((a, b) => a.sortKey - b.sortKey)
      .map(({ label, revenue, orders: count }) => ({ label, revenue, orders: count }));
  }, [filteredOrders, timeframe]);

  const topItems = useMemo(() => {
    const itemStats = new Map<string, { name: string; quantity: number; revenue: number }>();
    filteredOrders.forEach((order) => {
      (order.items || []).forEach((item) => {
        const key = item.name.trim();
        const prev = itemStats.get(key) || { name: key, quantity: 0, revenue: 0 };
        prev.quantity += Number(item.quantity) || 0;
        prev.revenue =
          Math.round((prev.revenue + (Number(item.price) || 0) * (Number(item.quantity) || 0)) * 100) /
          100;
        itemStats.set(key, prev);
      });
    });

    return Array.from(itemStats.values())
      .sort((a, b) => b.quantity - a.quantity || b.revenue - a.revenue)
      .slice(0, 5);
  }, [filteredOrders]);

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-24 bg-white border border-slate-200 rounded-lg animate-pulse" />
          ))}
        </div>
        <div className="grid lg:grid-cols-12 gap-6">
          <div className="lg:col-span-7 h-80 bg-white border border-slate-200 rounded-lg animate-pulse" />
          <div className="lg:col-span-5 h-80 bg-white border border-slate-200 rounded-lg animate-pulse" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Section Header & Timeframe Segmented Control */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-lg font-semibold text-slate-900">
            Performance Analytics
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Live aggregated metrics for {shop.name} updated automatically as orders arrive.
          </p>
        </div>

        <div className="flex items-center gap-1 p-1 bg-slate-200/70 rounded-lg self-start sm:self-auto">
          {(
            [
              { id: 'today', label: 'Today' },
              { id: '7d', label: '7 Days' },
              { id: '30d', label: '30 Days' },
              { id: 'all', label: 'All Time' },
            ] as const
          ).map((tf) => (
            <button
              key={tf.id}
              type="button"
              onClick={() => setTimeframe(tf.id)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                timeframe === tf.id
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {tf.label}
            </button>
          ))}
        </div>
      </div>

      {/* 4-Column KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-lg p-5">
          <p className="text-xs font-medium text-slate-500">Total Orders Processed</p>
          <p className="mt-2 font-mono text-2xl font-semibold text-slate-900 tabular-nums">
            {kpis.totalOrders}
          </p>
          <p className="mt-1 text-xs text-slate-500 tabular-nums">
            {kpis.paidCount} paid · {kpis.completedCount} served or paid
          </p>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg p-5">
          <p className="text-xs font-medium text-slate-500">Total Revenue Generated</p>
          <p className="mt-2 font-mono text-2xl font-semibold text-slate-900 tabular-nums">
            {formatCurrency(kpis.totalRevenue)}
          </p>
          <p className="mt-1 text-xs text-slate-500">Gross order value</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg p-5">
          <p className="text-xs font-medium text-slate-500">Average Order Value</p>
          <p className="mt-2 font-mono text-2xl font-semibold text-slate-900 tabular-nums">
            {formatCurrency(kpis.avgOrderValue)}
          </p>
          <p className="mt-1 text-xs text-slate-500">Per ticket average</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg p-5">
          <p className="text-xs font-medium text-slate-500">Fulfillment Rate</p>
          <p className="mt-2 font-mono text-2xl font-semibold text-emerald-700 tabular-nums">
            {kpis.completionRate}%
          </p>
          <p className="mt-1 text-xs text-slate-500">Orders served or settled</p>
        </div>
      </div>

      {filteredOrders.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-lg px-6 py-16 text-center max-w-full">
          <BarChart3 className="w-8 h-8 text-slate-300 mx-auto mb-3" />
          <h3 className="text-base font-semibold text-slate-900">
            No order data in this timeframe yet
          </h3>
          <p className="mt-1.5 text-sm text-slate-600 max-w-md mx-auto">
            Revenue trends and Top 5 ordered menu items populate automatically as soon as guests or
            servers submit orders for this shop.
          </p>
          <button
            type="button"
            onClick={onOpenStorefront}
            className="mt-5 inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
          >
            Open Public Storefront
            <ExternalLink className="w-3.5 h-3.5" />
          </button>
        </div>
      ) : (
        <div className="grid lg:grid-cols-12 gap-6">
          {/* Revenue Trend Chart */}
          <div className="lg:col-span-7 bg-white border border-slate-200 rounded-lg p-6">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h3 className="font-display text-sm font-semibold text-slate-900">
                  Revenue Trend
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Gross revenue aggregated by {timeframe === 'today' ? 'hour' : 'day'}
                </p>
              </div>
              <span className="font-mono text-xs text-slate-500 tabular-nums">
                {revenueTrend.length} {revenueTrend.length === 1 ? 'interval' : 'intervals'}
              </span>
            </div>

            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={revenueTrend} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="shopRevenueGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={accent} stopOpacity={0.22} />
                      <stop offset="95%" stopColor={accent} stopOpacity={0.01} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 11, fill: '#64748B' }}
                    axisLine={{ stroke: '#E2E8F0' }}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: '#64748B' }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(v) => `₹${v}`}
                    width={62}
                  />
                  <Tooltip
                    formatter={(value: unknown) => [formatCurrency(Number(value) || 0), 'Revenue']}
                    contentStyle={{
                      backgroundColor: '#FFFFFF',
                      border: '1px solid #E2E8F0',
                      borderRadius: '8px',
                      fontSize: '12px',
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="revenue"
                    stroke={accent}
                    strokeWidth={2}
                    fillOpacity={1}
                    fill="url(#shopRevenueGradient)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Top 5 Most Frequently Ordered Items */}
          <div className="lg:col-span-5 bg-white border border-slate-200 rounded-lg p-6 flex flex-col">
            <div className="mb-5">
              <h3 className="font-display text-sm font-semibold text-slate-900">
                Top 5 Most Ordered Items
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Ranked by total unit volume across all orders
              </p>
            </div>

            <div className="h-52 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={topItems}
                  layout="vertical"
                  margin={{ top: 0, right: 16, left: 4, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" horizontal={false} />
                  <XAxis
                    type="number"
                    allowDecimals={false}
                    tick={{ fontSize: 11, fill: '#64748B' }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    type="category"
                    dataKey="name"
                    width={118}
                    tick={{ fontSize: 11, fill: '#334155' }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(val: string) =>
                      val.length > 16 ? `${val.slice(0, 15)}…` : val
                    }
                  />
                  <Tooltip
                    formatter={(value: unknown) => [`${value} units`, 'Ordered']}
                    contentStyle={{
                      backgroundColor: '#FFFFFF',
                      border: '1px solid #E2E8F0',
                      borderRadius: '8px',
                      fontSize: '12px',
                    }}
                  />
                  <Bar dataKey="quantity" fill={accent} radius={[0, 4, 4, 0]} barSize={20} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Companion Tabular Summary */}
            <div className="mt-4 pt-4 border-t border-slate-200 divide-y divide-slate-100">
              {topItems.map((item, idx) => (
                <div key={item.name} className="py-2 flex items-center justify-between gap-3 text-xs">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className="font-mono text-slate-400 tabular-nums w-4">0{idx + 1}</span>
                    <span className="font-medium text-slate-800 truncate">{item.name}</span>
                  </div>
                  <div className="flex items-center gap-3 shrink-0 font-mono tabular-nums">
                    <span className="text-slate-600">{item.quantity} sold</span>
                    <span className="text-slate-900 font-medium w-16 text-right">
                      {formatCurrency(item.revenue)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
