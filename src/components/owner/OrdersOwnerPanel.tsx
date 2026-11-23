import React, { useEffect, useMemo, useState } from 'react';
import {
  Ban,
  Banknote,
  CheckCircle2,
  ClipboardList,
  ExternalLink,
  Phone,
  QrCode,
  Search,
} from 'lucide-react';
import { Order, OrderStatus, PaymentMethod, Shop } from '../../types';
import { cancelOrder, settleOrderPayment, updateOrderStatus } from '../../lib/firestoreService';
import { getEffectivePaymentMethod, getEffectivePaymentStatus } from '../../lib/upi';
import { formatCurrency, formatTimeAgo } from '../../lib/validation';
import { useToast } from '../../context/ToastContext';
import { PaymentVerificationSidebar } from '../PaymentVerificationSidebar';

interface OrdersOwnerPanelProps {
  shop: Shop;
  orders: Order[];
  loading: boolean;
  isLiveConnected: boolean;
  canOpenServerView: boolean;
  onOpenServerView: () => void;
}

const STATUS_STYLE: Record<OrderStatus, string> = {
  pending: 'text-amber-700 font-semibold',
  preparing: 'text-blue-700 font-semibold',
  ready: 'text-emerald-700 font-semibold',
  served: 'text-indigo-700 font-semibold',
  paid: 'text-slate-500 font-medium',
  cancelled: 'text-red-700 font-medium',
};

const STATUS_LABEL: Record<OrderStatus, string> = {
  pending: 'Pending',
  preparing: 'Preparing',
  ready: 'Ready',
  served: 'Served',
  paid: 'Paid',
  cancelled: 'Cancelled',
};

function getTimestampMs(ts: unknown): number | null {
  if (ts && typeof (ts as { toMillis?: () => number }).toMillis === 'function') {
    return (ts as { toMillis: () => number }).toMillis();
  }
  return null;
}

export const OrdersOwnerPanel: React.FC<OrdersOwnerPanelProps> = ({
  shop,
  orders,
  loading,
  isLiveConnected,
  canOpenServerView,
  onOpenServerView,
}) => {
  const { pushToast } = useToast();
  const [statusFilter, setStatusFilter] = useState<'all' | 'verify_upi' | OrderStatus>('all');
  const [search, setSearch] = useState('');
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [confirmingPaymentId, setConfirmingPaymentId] = useState<string | null>(null);
  const [inspectorUpiModeId, setInspectorUpiModeId] = useState<string | null>(null);
  const [inspectorUtrDrafts, setInspectorUtrDrafts] = useState<Record<string, string>>({});
  const [confirmVoidId, setConfirmVoidId] = useState<string | null>(null);
  const [voidingId, setVoidingId] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const counts = useMemo(() => {
    const map: Record<'all' | 'verify_upi' | OrderStatus, number> = {
      all: orders.length,
      verify_upi: 0,
      pending: 0,
      preparing: 0,
      ready: 0,
      served: 0,
      paid: 0,
      cancelled: 0,
    };
    orders.forEach((o) => {
      map[o.status] += 1;
      if (
        o.status !== 'cancelled' &&
        getEffectivePaymentMethod(o.payment_method) === 'upi' &&
        getEffectivePaymentStatus(o.payment_status, o.status) === 'verification_pending'
      ) {
        map.verify_upi += 1;
      }
    });
    return map;
  }, [orders]);

  const filteredOrders = useMemo(() => {
    return orders.filter((o) => {
      if (statusFilter === 'verify_upi') {
        const needsVerify =
          o.status !== 'cancelled' &&
          getEffectivePaymentMethod(o.payment_method) === 'upi' &&
          getEffectivePaymentStatus(o.payment_status, o.status) === 'verification_pending';
        if (!needsVerify) return false;
      } else if (statusFilter !== 'all' && o.status !== statusFilter) {
        return false;
      }
      if (!search.trim()) return true;
      const q = search.toLowerCase();
      return (
        o.order_number.toLowerCase().includes(q) ||
        o.customer_name.toLowerCase().includes(q) ||
        o.table_or_room.toLowerCase().includes(q) ||
        (o.customer_phone && o.customer_phone.toLowerCase().includes(q)) ||
        (o.utr_number && o.utr_number.toLowerCase().includes(q))
      );
    });
  }, [orders, statusFilter, search]);

  const activeOrder = useMemo(
    () => orders.find((o) => o.id === selectedOrderId) || filteredOrders[0] || null,
    [orders, filteredOrders, selectedOrderId]
  );

  const getInspectorUtr = (order: Order): string => {
    if (order.id in inspectorUtrDrafts) return inspectorUtrDrafts[order.id];
    return order.utr_number || '';
  };

  const handleSettleFromInspector = async (order: Order, method: PaymentMethod) => {
    setConfirmingPaymentId(order.id);
    try {
      const alreadyPaid = getEffectivePaymentStatus(order.payment_status, order.status) === 'paid';
      if (alreadyPaid && order.status === 'served') {
        await updateOrderStatus(shop.id, order.id, 'paid', true);
      } else {
        const utrVal = method === 'upi' ? getInspectorUtr(order).trim() : null;
        await settleOrderPayment(shop.id, order.id, {
          payment_method: method,
          utr_number: utrVal || null,
          transitionToPaid: order.status === 'served',
        });
      }
      setInspectorUpiModeId((prev) => (prev === order.id ? null : prev));
      const methodLabel = method === 'upi' ? 'UPI' : 'Cash';
      pushToast(
        `Payment Confirmed (${methodLabel})`,
        `${order.order_number} · ${formatCurrency(order.total_amount)} settled.`,
        'success'
      );
    } catch (err) {
      pushToast(
        'Payment confirmation failed',
        err instanceof Error ? err.message : 'Unable to confirm payment.',
        'error'
      );
    } finally {
      setConfirmingPaymentId(null);
    }
  };

  const handleVoidOrder = async (order: Order) => {
    setVoidingId(order.id);
    try {
      await cancelOrder(shop.id, order.id);
      setConfirmVoidId(null);
      pushToast(
        `Order ${order.order_number} cancelled`,
        `${order.customer_name} (${order.table_or_room}) removed from active bills.`,
        'info'
      );
    } catch (err) {
      pushToast(
        'Cancellation failed',
        err instanceof Error ? err.message : 'Unable to cancel order.',
        'error'
      );
    } finally {
      setVoidingId(null);
    }
  };

  return (
    <div className="flex flex-col xl:flex-row items-start gap-5">
      {/* Main Orders Ledger & Inspector */}
      <div className="flex-1 min-w-0 w-full space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5">
              <h2 className="font-display text-xl font-bold text-stone-950 tracking-tight">
                Live Orders &amp; Settlement
              </h2>
              {isLiveConnected && (
                <span className="text-xs text-emerald-700 font-medium">· Live sync</span>
              )}
            </div>
            <p className="text-xs text-stone-500 mt-1">
              Servers advance kitchen stages. Confirm Cash collection or verify UPI transactions in
              Payment Verification to close bills.
            </p>
          </div>

          {canOpenServerView && (
            <button
              type="button"
              onClick={onOpenServerView}
              className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold text-stone-700 bg-white border border-stone-300 rounded-lg hover:bg-stone-50 shadow-2xs transition-colors whitespace-nowrap self-start sm:self-auto cursor-pointer"
            >
              Open Kitchen Board
              <ExternalLink className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Filter & Search Bar + Orders Table */}
        <div className="surface-card rounded-2xl overflow-hidden">
          <div className="p-4 border-b border-stone-200/75 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
            <div className="relative flex-1 max-w-sm">
              <Search className="w-4 h-4 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Filter by order #, guest, phone, table, or UTR..."
                className="w-full pl-9 pr-3 py-2 text-sm bg-white/75 border border-stone-200/90 rounded-xl focus:bg-white focus:border-stone-900 focus:outline-none transition-colors"
              />
            </div>

            <div className="flex items-center gap-1 p-1 glass-segmented rounded-xl overflow-x-auto max-w-full">
              {(
                [
                  'all',
                  'verify_upi',
                  'pending',
                  'preparing',
                  'ready',
                  'served',
                  'paid',
                  'cancelled',
                ] as const
              ).map((status) => (
                <button
                  key={status}
                  type="button"
                  onClick={() => setStatusFilter(status)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5 cursor-pointer ${
                    statusFilter === status
                      ? 'bg-white text-slate-900 shadow-xs'
                      : status === 'verify_upi' && counts.verify_upi > 0
                        ? 'text-amber-800 hover:text-amber-900'
                        : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <span className={status === 'verify_upi' ? '' : 'capitalize'}>
                    {status === 'verify_upi' ? 'Verify UPI' : status}
                  </span>
                  <span
                    className={`font-mono text-[11px] tabular-nums ${
                      status === 'verify_upi' && counts.verify_upi > 0
                        ? 'text-amber-700 font-semibold'
                        : 'text-slate-400'
                    }`}
                  >
                    {counts[status]}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {loading ? (
            <div className="p-6 space-y-3">
              {[1, 2, 3, 4].map((n) => (
                <div key={n} className="h-12 bg-slate-100 rounded animate-pulse" />
              ))}
            </div>
          ) : filteredOrders.length === 0 ? (
            <div className="px-6 py-14 text-center max-w-md mx-auto">
              <ClipboardList className="w-8 h-8 text-slate-300 mx-auto mb-3" />
              <h3 className="text-base font-semibold text-slate-900">No orders in this view</h3>
              <p className="mt-1.5 text-sm text-slate-600">
                New guest orders from <span className="font-mono">/s/{shop.slug}</span> and tickets
                entered by servers appear here instantaneously.
              </p>
            </div>
          ) : (
            <div className="grid lg:grid-cols-12 divide-y lg:divide-y-0 lg:divide-x divide-slate-200">
              <div className="lg:col-span-7 overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-medium text-slate-500">
                      <th className="py-3 px-4">Order</th>
                      <th className="py-3 px-3">Guest & Table</th>
                      <th className="py-3 px-3">Payment</th>
                      <th className="py-3 px-3">Status</th>
                      <th className="py-3 px-4 text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 text-sm">
                    {filteredOrders.map((order) => {
                      const isSelected = activeOrder?.id === order.id;
                      const createdDate =
                        order.created_at && typeof order.created_at.toDate === 'function'
                          ? order.created_at.toDate()
                          : null;
                      const payMethod = getEffectivePaymentMethod(order.payment_method);
                      const payStatus = getEffectivePaymentStatus(
                        order.payment_status,
                        order.status
                      );
                      const isCancelled = order.status === 'cancelled';
                      const needsUpiVerify =
                        !isCancelled &&
                        payMethod === 'upi' &&
                        payStatus === 'verification_pending';
                      const servedRefMs =
                        getTimestampMs(order.updated_at) ?? getTimestampMs(order.created_at);
                      const unpaidServedMins =
                        order.status === 'served' && payStatus !== 'paid' && servedRefMs !== null
                          ? Math.floor((nowMs - servedRefMs) / 60_000)
                          : 0;
                      const isWalkOutRisk = unpaidServedMins >= 15;

                      return (
                        <tr
                          key={order.id}
                          onClick={() => {
                            setSelectedOrderId(order.id);
                            setConfirmVoidId(null);
                          }}
                          className={`cursor-pointer transition-colors ${
                            isSelected
                              ? 'bg-slate-100/80'
                              : needsUpiVerify
                                ? 'bg-amber-50/50 hover:bg-amber-50'
                                : isWalkOutRisk
                                  ? 'bg-red-50/40 hover:bg-red-50/70'
                                  : 'hover:bg-slate-50/60'
                          }`}
                        >
                          <td className="py-3 px-4 whitespace-nowrap">
                            <p
                              className={`font-mono text-xs font-semibold tabular-nums ${
                                isCancelled ? 'text-slate-400 line-through' : 'text-slate-900'
                              }`}
                            >
                              {order.order_number}
                            </p>
                            <p className="text-[11px] text-slate-500 mt-0.5">
                              {formatTimeAgo(createdDate)}
                            </p>
                          </td>
                          <td className="py-3 px-3">
                            <p className="font-medium text-slate-900 truncate max-w-[140px]">
                              {order.customer_name}
                            </p>
                            <p className="text-xs text-slate-500">{order.table_or_room}</p>
                          </td>
                          <td className="py-3 px-3 whitespace-nowrap">
                            {isCancelled ? (
                              <span className="text-xs text-slate-400">Voided</span>
                            ) : needsUpiVerify ? (
                              <div>
                                <p className="text-xs font-semibold text-amber-800">Verify UPI</p>
                                <p className="font-mono text-[11px] text-amber-700 tabular-nums">
                                  {order.utr_number || 'No UTR'}
                                </p>
                              </div>
                            ) : payStatus === 'paid' ? (
                              <span className="text-xs font-semibold text-emerald-700">
                                {payMethod === 'upi' ? 'UPI' : 'Cash'} · Paid
                              </span>
                            ) : isWalkOutRisk ? (
                              <span className="text-xs font-semibold text-red-700">
                                Unpaid · {unpaidServedMins}m
                              </span>
                            ) : (
                              <span className="text-xs text-slate-500">Unpaid</span>
                            )}
                          </td>
                          <td className="py-3 px-3 whitespace-nowrap">
                            <span className={`text-xs ${STATUS_STYLE[order.status]}`}>
                              {STATUS_LABEL[order.status]}
                            </span>
                          </td>
                          <td
                            className={`py-3 px-4 text-right font-mono text-sm font-medium tabular-nums whitespace-nowrap ${
                              isCancelled ? 'text-slate-400 line-through' : 'text-slate-900'
                            }`}
                          >
                            {formatCurrency(order.total_amount)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Selected Order Detail Inspector */}
              <div className="lg:col-span-5 p-5 bg-slate-50/40">
                {activeOrder ? (
                  <div className="space-y-4">
                    <div className="flex items-start justify-between gap-2 pb-3 border-b border-slate-200">
                      <div>
                        <p className="font-mono text-sm font-semibold text-slate-900">
                          {activeOrder.order_number}
                        </p>
                        <p className="text-xs text-slate-600 mt-0.5">
                          {activeOrder.customer_name} · {activeOrder.table_or_room}
                        </p>
                        {activeOrder.customer_phone && (
                          <a
                            href={`tel:${activeOrder.customer_phone}`}
                            className="mt-1 inline-flex items-center gap-1.5 text-xs font-mono text-blue-700 hover:underline"
                          >
                            <Phone className="w-3 h-3" />
                            {activeOrder.customer_phone}
                          </a>
                        )}
                      </div>
                      <span className={`text-xs ${STATUS_STYLE[activeOrder.status]}`}>
                        {STATUS_LABEL[activeOrder.status]}
                      </span>
                    </div>

                    {/* Payment Settlement Inspector Box */}
                    {(() => {
                      const isCancelled = activeOrder.status === 'cancelled';
                      const pMethod = getEffectivePaymentMethod(activeOrder.payment_method);
                      const pStatus = getEffectivePaymentStatus(
                        activeOrder.payment_status,
                        activeOrder.status
                      );
                      const isNeedsVerify =
                        !isCancelled && pMethod === 'upi' && pStatus === 'verification_pending';
                      const showUpiVerify =
                        isNeedsVerify || inspectorUpiModeId === activeOrder.id;
                      const busy = confirmingPaymentId === activeOrder.id;

                      if (isCancelled) {
                        return (
                          <div className="p-3 bg-red-50/70 border border-red-200 rounded-lg text-xs text-red-800">
                            <p className="font-semibold">Order Cancelled</p>
                            <p className="mt-0.5 text-red-700/90">
                              Excluded from sales totals and open bills.
                            </p>
                          </div>
                        );
                      }

                      if (pStatus === 'paid') {
                        return (
                          <div className="p-3 bg-white border border-slate-200 rounded-lg flex items-center justify-between gap-3">
                            <div>
                              <p className="text-[11px] text-slate-500">Payment Verified</p>
                              <p className="text-xs font-semibold text-emerald-700 mt-0.5">
                                Paid via {pMethod === 'upi' ? 'UPI' : 'Cash'}
                              </p>
                              {activeOrder.utr_number && (
                                <p className="font-mono text-[11px] text-slate-500 mt-0.5 tabular-nums">
                                  UTR: {activeOrder.utr_number}
                                </p>
                              )}
                            </div>
                            {activeOrder.status === 'served' && (
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => void handleSettleFromInspector(activeOrder, pMethod)}
                                className="px-3 py-1.5 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 disabled:opacity-60 rounded-md whitespace-nowrap cursor-pointer"
                              >
                                {busy ? 'Closing...' : 'Close Table'}
                              </button>
                            )}
                          </div>
                        );
                      }

                      if (showUpiVerify) {
                        return (
                          <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg space-y-2.5">
                            <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-900">
                              <QrCode className="w-3.5 h-3.5 text-amber-700 shrink-0" />
                              <span>Verify UPI Payment</span>
                            </div>
                            <div>
                              <label
                                htmlFor={`inspector-utr-${activeOrder.id}`}
                                className="block text-[11px] font-medium text-amber-900 mb-1"
                              >
                                UTR / Transaction Reference
                              </label>
                              <input
                                id={`inspector-utr-${activeOrder.id}`}
                                type="text"
                                maxLength={64}
                                value={getInspectorUtr(activeOrder)}
                                onChange={(e) =>
                                  setInspectorUtrDrafts((prev) => ({
                                    ...prev,
                                    [activeOrder.id]: e.target.value,
                                  }))
                                }
                                placeholder="Enter or confirm 12-digit UTR"
                                className="w-full px-2.5 py-1.5 font-mono text-xs bg-white border border-amber-300 rounded-md focus:border-amber-700 focus:outline-none"
                              />
                            </div>
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => void handleSettleFromInspector(activeOrder, 'upi')}
                                className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold text-white bg-amber-700 hover:bg-amber-800 disabled:opacity-60 rounded-lg transition-colors cursor-pointer"
                              >
                                <CheckCircle2 className="w-3.5 h-3.5" />
                                {busy ? 'Verifying...' : 'Confirm UPI Paid'}
                              </button>
                              {isNeedsVerify ? (
                                <button
                                  type="button"
                                  disabled={busy}
                                  onClick={() =>
                                    void handleSettleFromInspector(activeOrder, 'cash')
                                  }
                                  className="px-2.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg cursor-pointer"
                                >
                                  Cash
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => setInspectorUpiModeId(null)}
                                  className="px-2.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg cursor-pointer"
                                >
                                  Cancel
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      }

                      return (
                        <div className="p-3 bg-white border border-slate-200 rounded-lg space-y-2.5">
                          <div>
                            <p className="text-[11px] text-slate-500">Owner Settlement</p>
                            <p className="text-xs font-semibold text-slate-800 mt-0.5">
                              Unpaid · Open Bill
                            </p>
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => void handleSettleFromInspector(activeOrder, 'cash')}
                              className="inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-60 rounded-md whitespace-nowrap cursor-pointer"
                            >
                              <Banknote className="w-3.5 h-3.5" />
                              {busy ? 'Saving...' : 'Confirm Cash'}
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => setInspectorUpiModeId(activeOrder.id)}
                              className="inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold text-slate-800 bg-white border border-slate-300 hover:bg-slate-50 disabled:opacity-60 rounded-md whitespace-nowrap cursor-pointer"
                            >
                              <QrCode className="w-3.5 h-3.5 text-amber-700" />
                              Verify UPI
                            </button>
                          </div>
                        </div>
                      );
                    })()}

                    <div className="space-y-2.5">
                      <p className="text-xs font-medium text-slate-500">Order Items</p>
                      <ul className="divide-y divide-slate-200/80">
                        {activeOrder.items.map((item, idx) => (
                          <li
                            key={`${item.menu_item_id}-${idx}`}
                            className="py-2 flex items-center justify-between gap-3 text-xs"
                          >
                            <span className="text-slate-800">
                              <span className="font-mono font-semibold text-slate-900 mr-1.5 tabular-nums">
                                {item.quantity}x
                              </span>
                              {item.name}
                            </span>
                            <span className="font-mono text-slate-700 tabular-nums shrink-0">
                              {formatCurrency(item.price * item.quantity)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>

                    {activeOrder.notes && (
                      <div className="pt-3 border-t border-slate-200">
                        <p className="text-xs font-medium text-slate-500">Guest Notes</p>
                        <p className="mt-1 text-xs text-slate-700 leading-relaxed">
                          {activeOrder.notes}
                        </p>
                      </div>
                    )}

                    <div className="pt-3 border-t border-slate-200 flex items-center justify-between">
                      <span className="text-xs font-medium text-slate-600">Total Amount</span>
                      <span className="font-mono text-base font-semibold text-slate-900 tabular-nums">
                        {formatCurrency(activeOrder.total_amount)}
                      </span>
                    </div>

                    {/* Owner Cancel / Void Action for Mistaken or Abandoned Unpaid Orders */}
                    {activeOrder.status !== 'paid' &&
                      activeOrder.status !== 'cancelled' &&
                      getEffectivePaymentStatus(activeOrder.payment_status, activeOrder.status) !==
                        'paid' && (
                        <div className="pt-3 border-t border-slate-200">
                          {confirmVoidId === activeOrder.id ? (
                            <div className="p-3 rounded-lg bg-red-50 border border-red-200 space-y-2.5">
                              <p className="text-xs font-medium text-red-900">
                                Void {activeOrder.order_number}? This removes it from active bills
                                and sales totals.
                              </p>
                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  disabled={voidingId === activeOrder.id}
                                  onClick={() => void handleVoidOrder(activeOrder)}
                                  className="flex-1 px-3 py-1.5 text-xs font-semibold text-white bg-red-700 hover:bg-red-800 disabled:opacity-60 rounded-md cursor-pointer"
                                >
                                  {voidingId === activeOrder.id
                                    ? 'Cancelling...'
                                    : 'Confirm Cancel'}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setConfirmVoidId(null)}
                                  className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 cursor-pointer"
                                >
                                  Keep
                                </button>
                              </div>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setConfirmVoidId(activeOrder.id)}
                              className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium text-red-700 bg-white border border-red-200 hover:bg-red-50 rounded-lg transition-colors cursor-pointer"
                            >
                              <Ban className="w-3.5 h-3.5" />
                              Cancel / Void Mistaken Order
                            </button>
                          )}
                        </div>
                      )}
                  </div>
                ) : (
                  <p className="text-xs text-slate-500">
                    Select an order row to inspect line items.
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Docked Payment Verification Sidebar (Served Orders Awaiting Settlement) */}
      <aside
        className="w-full xl:w-[340px] 2xl:w-[376px] shrink-0 xl:sticky xl:top-20"
        aria-label="Payment Verification Sidebar"
      >
        <PaymentVerificationSidebar
          shop={shop}
          orders={orders}
          canSettlePayment={true}
          mode="docked"
          nowMs={nowMs}
        />
      </aside>
    </div>
  );
};
