import React, { useMemo, useState } from 'react';
import { Award, Phone, Search, Users } from 'lucide-react';
import { Timestamp } from 'firebase/firestore';
import { formatCurrency, formatIndianMobile } from '../../lib/validation';
import { Shop, ShopCustomer } from '../../types';

interface CustomersPanelProps {
  shop: Shop;
  customers: ShopCustomer[];
  loading: boolean;
}

function formatDateShort(ts: Timestamp | null | undefined): string {
  if (!ts || !(ts instanceof Timestamp)) return '—';
  return ts.toDate().toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export const CustomersPanel: React.FC<CustomersPanelProps> = ({ shop, customers, loading }) => {
  const [searchQuery, setSearchQuery] = useState('');

  const metrics = useMemo(() => {
    let repeatCount = 0;
    let totalPoints = 0;
    let totalSpent = 0;

    customers.forEach((c) => {
      if ((c.total_orders || 0) >= 2) repeatCount += 1;
      totalPoints += Number(c.reward_points) || 0;
      totalSpent += Number(c.total_spent) || 0;
    });

    return {
      totalMembers: customers.length,
      repeatCount,
      totalPoints,
      totalSpent,
    };
  }, [customers]);

  const filteredCustomers = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return customers;
    return customers.filter(
      (c) =>
        c.full_name.toLowerCase().includes(q) ||
        c.mobile_number.toLowerCase().includes(q) ||
        c.email.toLowerCase().includes(q)
    );
  }, [customers, searchQuery]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-xl font-semibold text-slate-900">
            Registered Customers & Rewards
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Verified diners registered directly at {shop.name}. Members earn 1 reward point per ₹10
            on settled bills.
          </p>
        </div>
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-xs font-medium text-slate-500">Registered Members</p>
          <p className="mt-2 font-mono text-2xl font-semibold text-slate-900 tabular-nums">
            {metrics.totalMembers}
          </p>
          <p className="mt-1 text-[11px] text-slate-500">Verified mobile accounts</p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-xs font-medium text-slate-500">Repeat Customers</p>
          <p className="mt-2 font-mono text-2xl font-semibold text-slate-900 tabular-nums">
            {metrics.repeatCount}
          </p>
          <p className="mt-1 text-[11px] text-slate-500">2+ settled orders</p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-xs font-medium text-slate-500">Total Reward Points</p>
          <p className="mt-2 font-mono text-2xl font-semibold text-amber-700 tabular-nums">
            {metrics.totalPoints.toLocaleString('en-IN')}
          </p>
          <p className="mt-1 text-[11px] text-slate-500">Active loyalty balance</p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-xs font-medium text-slate-500">Member Spend</p>
          <p className="mt-2 font-mono text-2xl font-semibold text-emerald-700 tabular-nums">
            {formatCurrency(metrics.totalSpent)}
          </p>
          <p className="mt-1 text-[11px] text-slate-500">Settled bills from members</p>
        </div>
      </div>

      {/* Directory Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Award className="w-4 h-4 text-slate-500" />
            <h2 className="text-sm font-semibold text-slate-900">Member Roster</h2>
            <span className="text-xs font-mono text-slate-500 tabular-nums">
              ({filteredCustomers.length})
            </span>
          </div>

          <div className="relative w-full sm:w-72">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search name, mobile, or email..."
              className="w-full pl-8 pr-3 py-1.5 text-xs border border-slate-300 rounded-lg focus:border-blue-600 focus:outline-none"
            />
          </div>
        </div>

        {loading ? (
          <div className="p-8 text-center text-xs text-slate-500">Loading customer roster...</div>
        ) : filteredCustomers.length === 0 ? (
          <div className="p-10 text-center space-y-2">
            <Users className="w-7 h-7 text-slate-300 mx-auto" />
            <p className="text-sm font-semibold text-slate-800">
              {customers.length === 0 ? 'No registered customers yet' : 'No matching customers'}
            </p>
            <p className="text-xs text-slate-500 max-w-md mx-auto">
              {customers.length === 0
                ? 'Customers who register on your public storefront will appear here with their verified mobile number, order history, and reward points.'
                : 'Try adjusting your search query.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  <th className="py-3 px-5">Customer</th>
                  <th className="py-3 px-4">Mobile</th>
                  <th className="py-3 px-4 text-right">Paid Orders</th>
                  <th className="py-3 px-4 text-right">Total Spent</th>
                  <th className="py-3 px-4 text-right">Reward Points</th>
                  <th className="py-3 px-5 text-right">Last Order</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-xs">
                {filteredCustomers.map((c) => (
                  <tr key={c.id} className="hover:bg-slate-50/70 transition-colors">
                    <td className="py-3.5 px-5">
                      <p className="font-semibold text-slate-900">{c.full_name}</p>
                      <p className="text-[11px] text-slate-500 truncate max-w-[220px]">{c.email}</p>
                    </td>
                    <td className="py-3.5 px-4 whitespace-nowrap">
                      <a
                        href={`tel:${c.mobile_number}`}
                        className="inline-flex items-center gap-1.5 font-mono text-slate-800 hover:text-blue-700 tabular-nums"
                      >
                        <Phone className="w-3 h-3 text-slate-400" />
                        <span>{formatIndianMobile(c.mobile_number)}</span>
                      </a>
                    </td>
                    <td className="py-3.5 px-4 text-right font-mono font-medium text-slate-900 tabular-nums">
                      {c.total_orders || 0}
                    </td>
                    <td className="py-3.5 px-4 text-right font-mono font-medium text-slate-900 tabular-nums">
                      {formatCurrency(c.total_spent || 0)}
                    </td>
                    <td className="py-3.5 px-4 text-right font-mono font-semibold text-amber-700 tabular-nums">
                      {(c.reward_points || 0).toLocaleString('en-IN')} pts
                    </td>
                    <td className="py-3.5 px-5 text-right text-slate-500 whitespace-nowrap">
                      {c.last_order_at
                        ? formatDateShort(c.last_order_at)
                        : `Joined ${formatDateShort(c.created_at)}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
