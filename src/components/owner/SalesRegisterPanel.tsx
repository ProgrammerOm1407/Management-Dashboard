import React, { useMemo, useState } from 'react';
import { CheckCircle2, Clock, IndianRupee, Search, Wallet } from 'lucide-react';
import { Order, PaymentMethod, PaymentStatus, RoomBooking, Shop } from '../../types';
import { confirmBookingPayment, confirmOrderPayment } from '../../lib/firestoreService';
import { getEffectivePaymentMethod, getEffectivePaymentStatus } from '../../lib/upi';
import { formatCurrency, formatTimeAgo } from '../../lib/validation';
import { useToast } from '../../context/ToastContext';

interface SalesRegisterPanelProps {
  shop: Shop;
  orders: Order[];
  bookings: RoomBooking[];
  loading: boolean;
}

type Timeframe = 'today' | '7d' | '30d' | 'all';
type SourceFilter = 'all' | 'food' | 'room';
type PaymentFilter = 'all' | 'paid' | 'cash' | 'upi' | 'pending_upi';

interface LedgerRow {
  id: string;
  kind: 'food' | 'room';
  reference: string;
  guestName: string;
  detail: string;
  amount: number;
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
  utrNumber: string | null;
  timestamp: Date;
  paidAt: Date | null;
  statusLabel: string;
  canConfirm: boolean;
}

function toSafeDate(ts: unknown): Date {
  if (ts && typeof (ts as { toDate?: () => Date }).toDate === 'function') {
    return (ts as { toDate: () => Date }).toDate();
  }
  return new Date();
}

export const SalesRegisterPanel: React.FC<SalesRegisterPanelProps> = ({
  shop,
  orders,
  bookings,
  loading,
}) => {
  const { pushToast } = useToast();
  const [timeframe, setTimeframe] = useState<Timeframe>('30d');
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');
  const [paymentFilter, setPaymentFilter] = useState<PaymentFilter>('all');
  const [search, setSearch] = useState('');
  const [confirmingKey, setConfirmingKey] = useState<string | null>(null);

  const allRows: LedgerRow[] = useMemo(() => {
    const orderRows: LedgerRow[] = orders
      .filter((o) => o.status !== 'cancelled')
      .map((o) => {
      const paymentMethod = getEffectivePaymentMethod(o.payment_method);
      const paymentStatus = getEffectivePaymentStatus(o.payment_status, o.status);
      return {
        id: o.id,
        kind: 'food',
        reference: o.order_number,
        guestName: o.customer_name,
        detail: `${o.table_or_room} · ${o.items.reduce((s, i) => s + i.quantity, 0)} items`,
        amount: Number(o.total_amount) || 0,
        paymentMethod,
        paymentStatus,
        utrNumber: o.utr_number || null,
        timestamp: toSafeDate(o.created_at),
        paidAt: o.paid_at ? toSafeDate(o.paid_at) : null,
        statusLabel: o.status,
        canConfirm: paymentStatus !== 'paid',
      };
    });

    const bookingRows: LedgerRow[] = bookings
      .filter((b) => b.status !== 'cancelled')
      .map((b) => {
        const paymentMethod = getEffectivePaymentMethod(b.payment_method);
        const paymentStatus = getEffectivePaymentStatus(b.payment_status);
        return {
          id: b.id,
          kind: 'room',
          reference: `Room ${b.room_number}`,
          guestName: b.guest_name,
          detail: `${b.check_in} → ${b.check_out}`,
          amount: Number(b.total_price) || 0,
          paymentMethod,
          paymentStatus,
          utrNumber: b.utr_number || null,
          timestamp: toSafeDate(b.created_at),
          paidAt: b.paid_at ? toSafeDate(b.paid_at) : null,
          statusLabel: b.status.replace('_', ' '),
          canConfirm: paymentStatus !== 'paid',
        };
      });

    return [...orderRows, ...bookingRows].sort(
      (a, b) => b.timestamp.getTime() - a.timestamp.getTime()
    );
  }, [orders, bookings]);

  const timeframeRows = useMemo(() => {
    if (timeframe === 'all') return allRows;
    const now = new Date();
    const cutoff = new Date(now);
    if (timeframe === 'today') {
      cutoff.setHours(0, 0, 0, 0);
    } else if (timeframe === '7d') {
      cutoff.setDate(now.getDate() - 7);
    } else {
      cutoff.setDate(now.getDate() - 30);
    }
    return allRows.filter((row) => row.timestamp >= cutoff);
  }, [allRows, timeframe]);

  const totals = useMemo(() => {
    let cashCollected = 0;
    let cashCount = 0;
    let upiCollected = 0;
    let upiCount = 0;
    let pendingUpiAmount = 0;
    let pendingUpiCount = 0;
    let unpaidCashAmount = 0;
    let unpaidCashCount = 0;

    timeframeRows.forEach((row) => {
      if (sourceFilter !== 'all' && row.kind !== sourceFilter) return;

      if (row.paymentStatus === 'paid') {
        if (row.paymentMethod === 'upi') {
          upiCollected += row.amount;
          upiCount += 1;
        } else {
          cashCollected += row.amount;
          cashCount += 1;
        }
      } else if (row.paymentMethod === 'upi' && row.paymentStatus === 'verification_pending') {
        pendingUpiAmount += row.amount;
        pendingUpiCount += 1;
      } else {
        unpaidCashAmount += row.amount;
        unpaidCashCount += 1;
      }
    });

    const totalCollected = cashCollected + upiCollected;
    const cashShare = totalCollected > 0 ? Math.round((cashCollected / totalCollected) * 100) : 0;
    const upiShare = totalCollected > 0 ? 100 - cashShare : 0;

    return {
      totalCollected,
      totalPaidCount: cashCount + upiCount,
      cashCollected,
      cashCount,
      upiCollected,
      upiCount,
      pendingUpiAmount,
      pendingUpiCount,
      unpaidCashAmount,
      unpaidCashCount,
      cashShare,
      upiShare,
    };
  }, [timeframeRows, sourceFilter]);

  const filteredRows = useMemo(() => {
    return timeframeRows.filter((row) => {
      if (sourceFilter !== 'all' && row.kind !== sourceFilter) return false;
      if (paymentFilter === 'paid' && row.paymentStatus !== 'paid') return false;
      if (paymentFilter === 'cash' && row.paymentMethod !== 'cash') return false;
      if (paymentFilter === 'upi' && row.paymentMethod !== 'upi') return false;
      if (
        paymentFilter === 'pending_upi' &&
        !(row.paymentMethod === 'upi' && row.paymentStatus === 'verification_pending')
      ) {
        return false;
      }
      if (!search.trim()) return true;
      const q = search.toLowerCase();
      return (
        row.reference.toLowerCase().includes(q) ||
        row.guestName.toLowerCase().includes(q) ||
        (row.utrNumber || '').toLowerCase().includes(q) ||
        row.detail.toLowerCase().includes(q)
      );
    });
  }, [timeframeRows, sourceFilter, paymentFilter, search]);

  const handleConfirmPaid = async (row: LedgerRow) => {
    const key = `${row.kind}-${row.id}`;
    setConfirmingKey(key);
    try {
      if (row.kind === 'food') {
        await confirmOrderPayment(shop.id, row.id);
      } else {
        await confirmBookingPayment(shop.id, row.id);
      }
      pushToast(
        'Payment confirmed',
        `${row.reference} (${formatCurrency(row.amount)}) recorded as ${row.paymentMethod.toUpperCase()} Paid.`,
        'success'
      );
    } catch (err) {
      pushToast(
        'Confirmation failed',
        err instanceof Error ? err.message : 'Unable to confirm payment.',
        'error'
      );
    } finally {
      setConfirmingKey(null);
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-24 bg-white border border-slate-200 rounded-lg animate-pulse" />
          ))}
        </div>
        <div className="h-72 bg-white border border-slate-200 rounded-lg animate-pulse" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header & Timeframe Selector */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-lg font-semibold text-slate-900">Sales Register</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Cash vs. UPI collections ledger across Food Orders
            {shop.modules.rooms ? ' and Hotel Room Bookings' : ''} for {shop.name}.
          </p>
        </div>

        <div className="flex items-center gap-1 p-1 glass-segmented rounded-2xl self-start sm:self-auto">
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
              className={`px-3.5 py-1.5 text-xs font-medium rounded-xl transition-all duration-150 whitespace-nowrap cursor-pointer ${
                timeframe === tf.id
                  ? 'bg-white text-stone-950 shadow-xs font-semibold'
                  : 'text-stone-600 hover:text-stone-950'
              }`}
            >
              {tf.label}
            </button>
          ))}
        </div>
      </div>

      {/* 4-Column Collection KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="surface-card rounded-2xl p-5 sm:p-6">
          <p className="text-xs font-medium text-stone-500">Total Collected</p>
          <p className="mt-2.5 font-mono text-[26px] leading-none font-semibold text-stone-950 tabular-nums">
            {formatCurrency(totals.totalCollected)}
          </p>
          <p className="mt-2.5 text-xs text-stone-500 tabular-nums">
            {totals.totalPaidCount} confirmed {totals.totalPaidCount === 1 ? 'payment' : 'payments'}
          </p>
        </div>

        <div className="surface-card rounded-2xl p-5 sm:p-6">
          <p className="text-xs font-medium text-stone-500">Cash Collected</p>
          <p className="mt-2.5 font-mono text-[26px] leading-none font-semibold text-emerald-700 tabular-nums">
            {formatCurrency(totals.cashCollected)}
          </p>
          <p className="mt-2.5 text-xs text-stone-500 tabular-nums">
            {totals.cashCount} settled · {totals.cashShare}% share
          </p>
        </div>

        <div className="surface-card rounded-2xl p-5 sm:p-6">
          <p className="text-xs font-medium text-stone-500">UPI Collected</p>
          <p className="mt-2.5 font-mono text-[26px] leading-none font-semibold text-blue-700 tabular-nums">
            {formatCurrency(totals.upiCollected)}
          </p>
          <p className="mt-2.5 text-xs text-stone-500 tabular-nums">
            {totals.upiCount} verified · {totals.upiShare}% share
          </p>
        </div>

        <div className="surface-card rounded-2xl p-5 sm:p-6">
          <p className="text-xs font-medium text-stone-500">Pending UPI Verification</p>
          <p
            className={`mt-2.5 font-mono text-[26px] leading-none font-semibold tabular-nums ${
              totals.pendingUpiCount > 0 ? 'text-amber-700' : 'text-stone-950'
            }`}
          >
            {formatCurrency(totals.pendingUpiAmount)}
          </p>
          <p className="mt-2.5 text-xs text-stone-500 tabular-nums">
            {totals.pendingUpiCount > 0 ? (
              <button
                type="button"
                onClick={() => setPaymentFilter('pending_upi')}
                className="font-semibold text-amber-700 hover:underline cursor-pointer"
              >
                {totals.pendingUpiCount} awaiting verification →
              </button>
            ) : (
              'All UPI transfers verified'
            )}
          </p>
        </div>
      </div>

      {/* Cash vs UPI Proportional Collection Split Bar */}
      <div className="surface-card rounded-2xl p-5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
          <span className="font-semibold text-stone-800">Collection Breakdown (Cash vs. UPI)</span>
          <div className="flex items-center gap-4 font-mono tabular-nums">
            <span className="text-emerald-700 font-semibold">
              Cash: {formatCurrency(totals.cashCollected)} ({totals.cashShare}%)
            </span>
            <span className="text-stone-300">·</span>
            <span className="text-blue-700 font-semibold">
              UPI: {formatCurrency(totals.upiCollected)} ({totals.upiShare}%)
            </span>
          </div>
        </div>
        <div className="h-2.5 w-full bg-stone-100 rounded-full overflow-hidden flex">
          {totals.totalCollected > 0 ? (
            <>
              <div
                className="h-full bg-emerald-600 transition-all"
                style={{ width: `${totals.cashShare}%` }}
                title={`Cash: ${formatCurrency(totals.cashCollected)}`}
              />
              <div
                className="h-full bg-blue-600 transition-all"
                style={{ width: `${totals.upiShare}%` }}
                title={`UPI: ${formatCurrency(totals.upiCollected)}`}
              />
            </>
          ) : (
            <div className="h-full w-full bg-stone-200/70" />
          )}
        </div>
        {totals.unpaidCashCount > 0 && (
          <p className="text-[11px] text-stone-500 font-mono tabular-nums">
            Unsettled counter / desk cash bills in this timeframe: {formatCurrency(totals.unpaidCashAmount)} ({totals.unpaidCashCount} open)
          </p>
        )}
      </div>

      {/* Ledger Table */}
      <div className="surface-card rounded-2xl overflow-hidden">
        <div className="p-4 border-b border-stone-200/75 space-y-3">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
            <div className="relative flex-1 max-w-sm">
              <Search className="w-4 h-4 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search order #, guest, room, or UTR..."
                className="w-full pl-9 pr-3 py-2 text-sm bg-white/75 border border-stone-200/90 rounded-xl focus:bg-white focus:border-stone-900 focus:outline-none transition-colors"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {shop.modules.rooms && (
                <div className="flex items-center gap-1 p-1 glass-segmented rounded-xl">
                  {(
                    [
                      { id: 'all', label: 'All Sources' },
                      { id: 'food', label: 'Food Orders' },
                      { id: 'room', label: 'Rooms' },
                    ] as const
                  ).map((src) => (
                    <button
                      key={src.id}
                      type="button"
                      onClick={() => setSourceFilter(src.id)}
                      className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                        sourceFilter === src.id
                          ? 'bg-white text-slate-900 shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      {src.label}
                    </button>
                  ))}
                </div>
              )}

              <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg overflow-x-auto max-w-full">
                {(
                  [
                    { id: 'all', label: 'All' },
                    { id: 'pending_upi', label: `Verify UPI (${totals.pendingUpiCount})` },
                    { id: 'upi', label: 'UPI' },
                    { id: 'cash', label: 'Cash' },
                    { id: 'paid', label: 'Settled' },
                  ] as const
                ).map((pf) => (
                  <button
                    key={pf.id}
                    type="button"
                    onClick={() => setPaymentFilter(pf.id)}
                    className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      paymentFilter === pf.id
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {pf.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {filteredRows.length === 0 ? (
          <div className="px-6 py-14 text-center max-w-md mx-auto">
            <Wallet className="w-8 h-8 text-slate-300 mx-auto mb-3" />
            <h3 className="text-base font-semibold text-slate-900">No transactions found</h3>
            <p className="mt-1.5 text-sm text-slate-600">
              Completed Cash and UPI transactions from food orders and room bookings appear here in
              real time.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-medium text-slate-500">
                  <th className="py-3 px-5">Reference</th>
                  <th className="py-3 px-4">Guest & Details</th>
                  <th className="py-3 px-4">Method & UTR</th>
                  <th className="py-3 px-4">Payment Status</th>
                  <th className="py-3 px-4 text-right">Amount</th>
                  <th className="py-3 px-5 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-sm">
                {filteredRows.map((row) => {
                  const isVerifyUpi =
                    row.paymentMethod === 'upi' && row.paymentStatus === 'verification_pending';
                  const rowKey = `${row.kind}-${row.id}`;
                  const busy = confirmingKey === rowKey;
                  return (
                    <tr
                      key={rowKey}
                      className={`transition-colors ${
                        isVerifyUpi ? 'bg-amber-50/60 hover:bg-amber-50/90' : 'hover:bg-slate-50/70'
                      }`}
                    >
                      <td className="py-3.5 px-5 whitespace-nowrap">
                        <p className="font-mono text-xs font-semibold text-slate-900 tabular-nums">
                          {row.reference}
                        </p>
                        <p className="text-[11px] text-slate-500 mt-0.5">
                          {row.kind === 'food' ? 'Food Order' : 'Room Booking'} ·{' '}
                          {formatTimeAgo(row.timestamp)}
                        </p>
                      </td>

                      <td className="py-3.5 px-4">
                        <p className="font-medium text-slate-900 truncate max-w-[180px]">
                          {row.guestName}
                        </p>
                        <p className="text-xs text-slate-500 font-mono tabular-nums">{row.detail}</p>
                      </td>

                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <p
                          className={`text-xs font-semibold ${
                            row.paymentMethod === 'upi' ? 'text-blue-700' : 'text-slate-700'
                          }`}
                        >
                          {row.paymentMethod === 'upi' ? 'UPI' : 'Cash'}
                        </p>
                        {row.utrNumber ? (
                          <p className="text-[11px] font-mono text-slate-600 tabular-nums mt-0.5">
                            UTR: {row.utrNumber}
                          </p>
                        ) : (
                          <p className="text-[11px] text-slate-400 mt-0.5">
                            {row.paymentMethod === 'upi' ? 'No UTR entered' : 'Counter / Desk'}
                          </p>
                        )}
                      </td>

                      <td className="py-3.5 px-4 whitespace-nowrap">
                        {row.paymentStatus === 'paid' ? (
                          <div>
                            <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700">
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              Paid
                            </span>
                            {row.paidAt && (
                              <p className="text-[11px] text-slate-400 mt-0.5">
                                {formatTimeAgo(row.paidAt)}
                              </p>
                            )}
                          </div>
                        ) : isVerifyUpi ? (
                          <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-800">
                            <Clock className="w-3.5 h-3.5" />
                            Verify UPI Payment
                          </span>
                        ) : (
                          <span className="text-xs font-medium text-slate-500">Unpaid</span>
                        )}
                      </td>

                      <td className="py-3.5 px-4 text-right font-mono text-sm font-semibold text-slate-900 tabular-nums whitespace-nowrap">
                        {formatCurrency(row.amount)}
                      </td>

                      <td className="py-3.5 px-5 text-right whitespace-nowrap">
                        {row.canConfirm ? (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void handleConfirmPaid(row)}
                            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md disabled:opacity-50 whitespace-nowrap cursor-pointer ${
                              isVerifyUpi
                                ? 'text-white bg-amber-700 hover:bg-amber-800'
                                : 'text-slate-800 bg-white border border-slate-300 hover:bg-slate-50'
                            }`}
                          >
                            <IndianRupee className="w-3 h-3" />
                            {busy ? 'Confirming...' : 'Confirm Paid'}
                          </button>
                        ) : (
                          <span className="text-xs text-slate-400">Settled</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
