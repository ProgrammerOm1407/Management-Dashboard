import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Banknote,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Lock,
  Phone,
  QrCode,
  Search,
  ShieldCheck,
  X,
} from 'lucide-react';
import { Order, PaymentMethod, Shop } from '../types';
import { settleOrderPayment, updateOrderStatus } from '../lib/firestoreService';
import { getEffectivePaymentMethod, getEffectivePaymentStatus } from '../lib/upi';
import { formatCurrency } from '../lib/validation';
import { useToast } from '../context/ToastContext';

interface PaymentVerificationSidebarProps {
  shop: Shop;
  orders: Order[];
  canSettlePayment: boolean;
  mode?: 'docked' | 'drawer';
  open?: boolean;
  onClose?: () => void;
  nowMs?: number;
  highlightedIds?: Record<string, 'new' | 'added' | 'upi'>;
}

type SettlementFilter = 'all' | 'upi_pending' | 'open_bill';

function getTimestampMs(ts: unknown): number | null {
  if (ts && typeof (ts as { toMillis?: () => number }).toMillis === 'function') {
    return (ts as { toMillis: () => number }).toMillis();
  }
  return null;
}

function formatElapsedMins(mins: number): string {
  if (mins < 1) return '<1m';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem > 0 ? `${hrs}h ${rem}m` : `${hrs}h`;
}

export const PaymentVerificationSidebar: React.FC<PaymentVerificationSidebarProps> = ({
  shop,
  orders,
  canSettlePayment,
  mode = 'docked',
  open = true,
  onClose,
  nowMs: externalNowMs,
  highlightedIds,
}) => {
  const { pushToast } = useToast();
  const [filter, setFilter] = useState<SettlementFilter>('all');
  const [search, setSearch] = useState('');
  const [expandedItems, setExpandedItems] = useState<Record<string, boolean>>({});
  const [upiModeOrderId, setUpiModeOrderId] = useState<string | null>(null);
  const [utrDrafts, setUtrDrafts] = useState<Record<string, string>>({});
  const [settlingOrderId, setSettlingOrderId] = useState<string | null>(null);

  const nowMs = externalNowMs ?? Date.now();

  const servedOrders = useMemo(() => {
    return orders
      .filter((o) => o.status === 'served')
      .sort((a, b) => {
        const aUpi =
          getEffectivePaymentMethod(a.payment_method) === 'upi' &&
          getEffectivePaymentStatus(a.payment_status, a.status) === 'verification_pending'
            ? 1
            : 0;
        const bUpi =
          getEffectivePaymentMethod(b.payment_method) === 'upi' &&
          getEffectivePaymentStatus(b.payment_status, b.status) === 'verification_pending'
            ? 1
            : 0;
        if (aUpi !== bUpi) return bUpi - aUpi;
        const tA = getTimestampMs(a.updated_at) ?? getTimestampMs(a.created_at) ?? 0;
        const tB = getTimestampMs(b.updated_at) ?? getTimestampMs(b.created_at) ?? 0;
        return tA - tB;
      });
  }, [orders]);

  const summary = useMemo(() => {
    let totalDue = 0;
    let upiPendingCount = 0;
    let openBillCount = 0;
    let walkOutRiskCount = 0;

    servedOrders.forEach((o) => {
      const pMethod = getEffectivePaymentMethod(o.payment_method);
      const pStatus = getEffectivePaymentStatus(o.payment_status, o.status);
      if (pStatus !== 'paid') {
        totalDue += Number(o.total_amount) || 0;
      }
      if (pMethod === 'upi' && pStatus === 'verification_pending') {
        upiPendingCount += 1;
      } else {
        openBillCount += 1;
      }
      const refMs = getTimestampMs(o.updated_at) ?? getTimestampMs(o.created_at);
      if (pStatus !== 'paid' && refMs !== null && nowMs - refMs >= 15 * 60_000) {
        walkOutRiskCount += 1;
      }
    });

    return {
      totalCount: servedOrders.length,
      totalDue,
      upiPendingCount,
      openBillCount,
      walkOutRiskCount,
    };
  }, [servedOrders, nowMs]);

  const filteredServedOrders = useMemo(() => {
    const q = search.trim().toLowerCase();
    return servedOrders.filter((o) => {
      const pMethod = getEffectivePaymentMethod(o.payment_method);
      const pStatus = getEffectivePaymentStatus(o.payment_status, o.status);
      const isUpiPending = pMethod === 'upi' && pStatus === 'verification_pending';

      if (filter === 'upi_pending' && !isUpiPending) return false;
      if (filter === 'open_bill' && isUpiPending) return false;

      if (!q) return true;
      return (
        o.table_or_room.toLowerCase().includes(q) ||
        o.order_number.toLowerCase().includes(q) ||
        o.customer_name.toLowerCase().includes(q) ||
        (o.utr_number && o.utr_number.toLowerCase().includes(q)) ||
        (o.customer_phone && o.customer_phone.toLowerCase().includes(q))
      );
    });
  }, [servedOrders, filter, search]);

  const toggleItemsExpanded = (orderId: string) => {
    setExpandedItems((prev) => ({ ...prev, [orderId]: !prev[orderId] }));
  };

  const getUtrValue = (order: Order): string => {
    if (order.id in utrDrafts) return utrDrafts[order.id];
    return order.utr_number || '';
  };

  const handleSettle = async (order: Order, method: PaymentMethod) => {
    if (!canSettlePayment) return;
    setSettlingOrderId(order.id);
    try {
      const alreadyPaid = getEffectivePaymentStatus(order.payment_status, order.status) === 'paid';
      if (alreadyPaid) {
        await updateOrderStatus(shop.id, order.id, 'paid', true);
      } else {
        const verifiedUtr = method === 'upi' ? getUtrValue(order).trim() : null;
        await settleOrderPayment(shop.id, order.id, {
          payment_method: method,
          utr_number: verifiedUtr || null,
          transitionToPaid: true,
        });
      }

      setUpiModeOrderId((prev) => (prev === order.id ? null : prev));
      setUtrDrafts((prev) => {
        if (!(order.id in prev)) return prev;
        const copy = { ...prev };
        delete copy[order.id];
        return copy;
      });

      const methodLabel = method === 'upi' ? 'UPI' : 'Cash';
      pushToast(
        `Settled via ${methodLabel} · ${order.order_number}`,
        `${order.table_or_room} (${order.customer_name}) · ${formatCurrency(order.total_amount)} marked Paid.`,
        'success'
      );
    } catch (err) {
      pushToast(
        'Settlement failed',
        err instanceof Error ? err.message : 'Unable to mark order as paid.',
        'error'
      );
    } finally {
      setSettlingOrderId(null);
    }
  };

  if (mode === 'drawer' && !open) {
    return null;
  }

  const panelBody = (
    <div
      className={`flex flex-col bg-white ${
        mode === 'drawer'
          ? 'h-full w-full max-w-md border-l border-slate-200 shadow-2xl'
          : 'border border-slate-200 rounded-lg overflow-hidden h-full'
      }`}
    >
      {/* Header */}
      <div className="px-4 py-3.5 border-b border-slate-200 bg-slate-50/80 shrink-0">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-slate-800 shrink-0" />
              <h3 className="font-display text-sm font-semibold text-slate-900 truncate">
                Payment Verification
              </h3>
              <span className="font-mono text-xs font-semibold text-slate-600 tabular-nums">
                {summary.totalCount}
              </span>
            </div>
            <p className="text-[11px] text-slate-500 mt-0.5">
              {canSettlePayment
                ? 'Served tables awaiting final Cash or UPI confirmation.'
                : 'Served tables awaiting Owner payment settlement.'}
            </p>
          </div>
          {mode === 'drawer' && onClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close Payment Verification sidebar"
              className="p-1 text-slate-400 hover:text-slate-700 rounded-md cursor-pointer shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Pending Settlement Totals Bar */}
        <div className="mt-3 pt-3 border-t border-slate-200/80 grid grid-cols-2 gap-3">
          <div>
            <p className="text-[11px] text-slate-500">Outstanding Served</p>
            <p className="font-mono text-base font-semibold text-slate-900 tabular-nums mt-0.5">
              {formatCurrency(summary.totalDue)}
            </p>
          </div>
          <div className="text-right">
            <p className="text-[11px] text-slate-500">UPI Awaiting Check</p>
            <p
              className={`font-mono text-base font-semibold tabular-nums mt-0.5 ${
                summary.upiPendingCount > 0 ? 'text-amber-700' : 'text-slate-600'
              }`}
            >
              {summary.upiPendingCount}
            </p>
          </div>
        </div>

        {/* Walk-out Warning Line */}
        {summary.walkOutRiskCount > 0 && (
          <div className="mt-2.5 flex items-center gap-1.5 text-[11px] font-semibold text-red-800 bg-red-50 border border-red-200 rounded-md px-2.5 py-1.5">
            <AlertTriangle className="w-3.5 h-3.5 text-red-700 shrink-0" />
            <span>
              {summary.walkOutRiskCount} served{' '}
              {summary.walkOutRiskCount === 1 ? 'bill is' : 'bills are'} open 15m+ unpaid
            </span>
          </div>
        )}

        {/* Filter Segmented Control + Quick Search */}
        {servedOrders.length > 0 && (
          <div className="mt-3 space-y-2">
            <div className="grid grid-cols-3 gap-1 p-1 bg-slate-200/70 rounded-md">
              {(
                [
                  { id: 'all', label: `All (${summary.totalCount})` },
                  { id: 'upi_pending', label: `UPI (${summary.upiPendingCount})` },
                  { id: 'open_bill', label: `Open (${summary.openBillCount})` },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setFilter(tab.id)}
                  className={`px-2 py-1 text-[11px] font-medium rounded transition-colors whitespace-nowrap cursor-pointer ${
                    filter === tab.id
                      ? 'bg-white text-slate-900 shadow-xs'
                      : tab.id === 'upi_pending' && summary.upiPendingCount > 0
                        ? 'text-amber-800 hover:text-amber-900'
                        : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {servedOrders.length >= 4 && (
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Filter table, order #, or UTR..."
                  className="w-full pl-8 pr-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-md focus:border-blue-600 focus:outline-none"
                />
              </div>
            )}
          </div>
        )}
      </div>

      {/* Served Bills Feed */}
      <div
        className={`flex-1 overflow-y-auto divide-y divide-slate-200 ${
          mode === 'docked' ? 'max-h-[calc(100vh-220px)]' : ''
        }`}
      >
        {servedOrders.length === 0 ? (
          <div className="px-5 py-12 text-center">
            <CheckCircle2 className="w-7 h-7 text-emerald-600/70 mx-auto mb-2.5" />
            <p className="text-sm font-semibold text-slate-900">All served tables settled</p>
            <p className="text-xs text-slate-500 mt-1 leading-relaxed">
              Orders marked <span className="font-medium text-slate-700">Served</span> on the
              kitchen board appear here for final Cash or UPI verification.
            </p>
          </div>
        ) : filteredServedOrders.length === 0 ? (
          <div className="px-5 py-10 text-center text-xs text-slate-500">
            No served bills match this filter.
          </div>
        ) : (
          filteredServedOrders.map((order) => {
            const payMethod = getEffectivePaymentMethod(order.payment_method);
            const payStatus = getEffectivePaymentStatus(order.payment_status, order.status);
            const isUpiPending = payMethod === 'upi' && payStatus === 'verification_pending';
            const isAlreadyPaid = payStatus === 'paid';
            const servedRefMs =
              getTimestampMs(order.updated_at) ?? getTimestampMs(order.created_at);
            const unpaidMins =
              servedRefMs !== null ? Math.max(0, Math.floor((nowMs - servedRefMs) / 60_000)) : 0;
            const isWalkOutRisk = !isAlreadyPaid && unpaidMins >= 15;
            const isAging = !isAlreadyPaid && unpaidMins >= 8 && unpaidMins < 15;
            const isSettling = settlingOrderId === order.id;
            const isItemsExpanded = Boolean(expandedItems[order.id]);
            const showUpiForm = isUpiPending || upiModeOrderId === order.id;
            const isHighlightedUpi = highlightedIds?.[order.id] === 'upi';
            const totalUnits = order.items.reduce((sum, i) => sum + i.quantity, 0);

            return (
              <div
                key={order.id}
                className={`p-4 space-y-3 transition-colors ${
                  isHighlightedUpi
                    ? 'bg-amber-50/90 ring-2 ring-inset ring-amber-400'
                    : isWalkOutRisk
                      ? 'bg-red-50/40'
                      : isUpiPending
                        ? 'bg-amber-50/40'
                        : 'bg-white'
                }`}
              >
                {/* Row 1: Table, Order #, Guest, Total & Served Timer */}
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-sm font-bold text-slate-900">
                        {order.table_or_room}
                      </span>
                      <span className="text-slate-300">·</span>
                      <span className="font-mono text-xs font-semibold text-slate-600 tabular-nums">
                        {order.order_number}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5 text-xs text-slate-600">
                      <span className="truncate">{order.customer_name}</span>
                      {order.customer_phone && (
                        <a
                          href={`tel:${order.customer_phone}`}
                          className="inline-flex items-center gap-1 font-mono text-[11px] text-blue-700 hover:underline"
                        >
                          <Phone className="w-3 h-3" />
                          {order.customer_phone}
                        </a>
                      )}
                    </div>
                  </div>

                  <div className="text-right shrink-0">
                    <p className="font-mono text-sm font-bold text-slate-900 tabular-nums">
                      {formatCurrency(order.total_amount)}
                    </p>
                    <p
                      className={`inline-flex items-center justify-end gap-1 font-mono text-[11px] font-medium tabular-nums mt-0.5 ${
                        isWalkOutRisk
                          ? 'text-red-700 font-semibold'
                          : isAging
                            ? 'text-amber-700'
                            : 'text-slate-500'
                      }`}
                    >
                      <Clock className="w-3 h-3" />
                      Served {formatElapsedMins(unpaidMins)}
                    </p>
                  </div>
                </div>

                {/* Expandable Item Breakdown */}
                <div className="border-t border-slate-200/70 pt-2">
                  <button
                    type="button"
                    onClick={() => toggleItemsExpanded(order.id)}
                    className="w-full flex items-center justify-between gap-2 text-left text-xs text-slate-600 hover:text-slate-900 cursor-pointer"
                  >
                    <span className="truncate">
                      <span className="font-mono font-semibold text-slate-800 tabular-nums">
                        {totalUnits} {totalUnits === 1 ? 'item' : 'items'}
                      </span>{' '}
                      · {order.items.map((i) => `${i.quantity}× ${i.name}`).join(', ')}
                    </span>
                    {isItemsExpanded ? (
                      <ChevronUp className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    ) : (
                      <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    )}
                  </button>

                  {isItemsExpanded && (
                    <ul className="mt-2 pt-2 border-t border-slate-100 space-y-1 text-xs">
                      {order.items.map((item, idx) => (
                        <li
                          key={`${item.menu_item_id}-${idx}`}
                          className="flex items-center justify-between gap-2 text-slate-700"
                        >
                          <span className="truncate">
                            <span className="font-mono font-semibold text-slate-900 tabular-nums mr-1.5">
                              {item.quantity}×
                            </span>
                            {item.name}
                          </span>
                          <span className="font-mono text-slate-600 tabular-nums shrink-0">
                            {formatCurrency(item.price * item.quantity)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {/* Walk-out Risk Alert */}
                {isWalkOutRisk && (
                  <div className="flex items-center gap-1.5 text-[11px] font-semibold text-red-800 bg-red-50 border border-red-200 rounded-md px-2.5 py-1.5">
                    <AlertTriangle className="w-3.5 h-3.5 text-red-700 shrink-0" />
                    <span>Unpaid {formatElapsedMins(unpaidMins)} · Verify table before exit</span>
                  </div>
                )}

                {/* Guest UPI Submission Info */}
                {isUpiPending && (
                  <div className="bg-amber-50 border border-amber-200 rounded-md px-2.5 py-2 space-y-1">
                    <div className="flex items-center justify-between gap-2 text-xs font-semibold text-amber-900">
                      <span className="inline-flex items-center gap-1.5">
                        <QrCode className="w-3.5 h-3.5 text-amber-700 shrink-0" />
                        Guest Submitted UPI Payment
                      </span>
                    </div>
                    <p className="font-mono text-[11px] text-amber-800 break-all tabular-nums">
                      Guest UTR: {order.utr_number || 'Not entered by guest'}
                    </p>
                  </div>
                )}

                {/* Owner Settlement Controls vs Server Read-Only Lock */}
                {canSettlePayment ? (
                  isAlreadyPaid ? (
                    <button
                      type="button"
                      disabled={isSettling}
                      onClick={() => void handleSettle(order, payMethod)}
                      className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 disabled:opacity-60 rounded-lg transition-colors cursor-pointer"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      {isSettling ? 'Closing...' : 'Close Paid Table'}
                    </button>
                  ) : showUpiForm ? (
                    <div className="space-y-2 pt-0.5">
                      <div>
                        <label
                          htmlFor={`utr-verify-${order.id}`}
                          className="block text-[11px] font-medium text-slate-700 mb-1"
                        >
                          Verified UPI UTR / Reference (Optional)
                        </label>
                        <input
                          id={`utr-verify-${order.id}`}
                          type="text"
                          maxLength={64}
                          value={getUtrValue(order)}
                          onChange={(e) =>
                            setUtrDrafts((prev) => ({ ...prev, [order.id]: e.target.value }))
                          }
                          placeholder="e.g. 432619820145"
                          className="w-full px-2.5 py-1.5 font-mono text-xs bg-white border border-slate-300 rounded-md focus:border-blue-600 focus:outline-none"
                        />
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          disabled={isSettling}
                          onClick={() => void handleSettle(order, 'upi')}
                          className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold text-white bg-amber-700 hover:bg-amber-800 disabled:opacity-60 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                          {isSettling ? 'Verifying...' : 'Confirm UPI Paid'}
                        </button>

                        {isUpiPending ? (
                          <button
                            type="button"
                            disabled={isSettling}
                            onClick={() => void handleSettle(order, 'cash')}
                            title="Guest paid cash at counter instead of UPI"
                            className="px-2.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 disabled:opacity-60 rounded-lg whitespace-nowrap cursor-pointer"
                          >
                            Cash
                          </button>
                        ) : (
                          <button
                            type="button"
                            disabled={isSettling}
                            onClick={() => setUpiModeOrderId(null)}
                            className="px-2.5 py-2 text-xs font-medium text-slate-600 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg whitespace-nowrap cursor-pointer"
                          >
                            Cancel
                          </button>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-2 pt-0.5">
                      <button
                        type="button"
                        disabled={isSettling}
                        onClick={() => void handleSettle(order, 'cash')}
                        className="inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-60 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
                      >
                        <Banknote className="w-3.5 h-3.5 shrink-0" />
                        {isSettling ? 'Saving...' : 'Confirm Cash'}
                      </button>

                      <button
                        type="button"
                        disabled={isSettling}
                        onClick={() => setUpiModeOrderId(order.id)}
                        className="inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-800 bg-white border border-slate-300 hover:bg-slate-50 disabled:opacity-60 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
                      >
                        <QrCode className="w-3.5 h-3.5 shrink-0 text-amber-700" />
                        Verify UPI
                      </button>
                    </div>
                  )
                ) : (
                  <div className="flex items-center justify-between gap-2 text-[11px] font-medium text-slate-600 bg-slate-50 border border-slate-200 rounded-md px-2.5 py-1.5">
                    <span className="inline-flex items-center gap-1.5">
                      <Lock className="w-3 h-3 text-slate-400 shrink-0" />
                      Owner settlement required
                    </span>
                    <span className="text-slate-500">
                      {isUpiPending ? 'UPI submitted' : 'Open bill'}
                    </span>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Footer RBAC Summary */}
      <div className="px-4 py-2.5 border-t border-slate-200 bg-slate-50/70 text-[11px] text-slate-500 shrink-0">
        {canSettlePayment
          ? 'Settling marks orders Paid and updates the Sales Register immediately.'
          : 'Notify the Shop Owner before releasing tables with unpaid served bills.'}
      </div>
    </div>
  );

  if (mode === 'drawer') {
    return (
      <div className="fixed inset-0 z-50 flex justify-end">
        <div
          className="fixed inset-0 bg-slate-950/40 backdrop-blur-[1px]"
          onClick={onClose}
        />
        <div className="relative z-10 h-full w-full max-w-md">{panelBody}</div>
      </div>
    );
  }

  return panelBody;
};
