import React, { useMemo, useState } from 'react';
import { CheckCircle2, ClipboardList, ExternalLink, QrCode, Search } from 'lucide-react';
import { Order, OrderStatus, Shop } from '../../types';
import { confirmOrderPayment, updateOrderStatus } from '../../lib/firestoreService';
import { getEffectivePaymentMethod, getEffectivePaymentStatus } from '../../lib/upi';
import { formatCurrency, formatTimeAgo } from '../../lib/validation';
import { useToast } from '../../context/ToastContext';

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
};

const STATUS_LABEL: Record<OrderStatus, string> = {
  pending: 'Pending',
  preparing: 'Preparing',
  ready: 'Ready',
  served: 'Served',
  paid: 'Paid',
};

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

  const counts = useMemo(() => {
    const map: Record<'all' | 'verify_upi' | OrderStatus, number> = {
      all: orders.length,
      verify_upi: 0,
      pending: 0,
      preparing: 0,
      ready: 0,
      served: 0,
      paid: 0,
    };
    orders.forEach((o) => {
      map[o.status] += 1;
      if (
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
        (o.utr_number && o.utr_number.toLowerCase().includes(q))
      );
    });
  }, [orders, statusFilter, search]);

  const activeOrder = useMemo(
    () => orders.find((o) => o.id === selectedOrderId) || filteredOrders[0] || null,
    [orders, filteredOrders, selectedOrderId]
  );

  const handleConfirmOrderPaid = async (order: Order) => {
    setConfirmingPaymentId(order.id);
    try {
      if (order.status === 'served') {
        await updateOrderStatus(shop.id, order.id, 'paid', false);
      } else {
        await confirmOrderPayment(shop.id, order.id);
      }
      const methodLabel =
        getEffectivePaymentMethod(order.payment_method) === 'upi' ? 'UPI' : 'Cash';
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

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h2 className="font-display text-lg font-semibold text-slate-900">
              Live Orders Feed
            </h2>
            {isLiveConnected && (
              <span className="inline-flex items-center gap-1.5 text-xs text-emerald-700 font-medium">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                Live sync active
              </span>
            )}
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Real-time order stream for {shop.name}. Servers update ticket stages from the Server
            workspace.
          </p>
        </div>

        {canOpenServerView && (
          <button
            type="button"
            onClick={onOpenServerView}
            className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 whitespace-nowrap self-start sm:self-auto cursor-pointer"
          >
            Open Server Queue
            <ExternalLink className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Filter & Search Bar */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="p-4 border-b border-slate-200 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter by order #, guest, table, or UTR..."
              className="w-full pl-9 pr-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:bg-white focus:border-blue-600 focus:outline-none"
            />
          </div>

          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg overflow-x-auto max-w-full">
            {(['all', 'verify_upi', 'pending', 'preparing', 'ready', 'served', 'paid'] as const).map(
              (status) => (
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
              )
            )}
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
            <div className="lg:col-span-8 overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-medium text-slate-500">
                    <th className="py-3 px-5">Order</th>
                    <th className="py-3 px-4">Guest & Location</th>
                    <th className="py-3 px-4">Payment</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-5 text-right">Total</th>
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
                    const needsUpiVerify =
                      payMethod === 'upi' && payStatus === 'verification_pending';
                    return (
                      <tr
                        key={order.id}
                        onClick={() => setSelectedOrderId(order.id)}
                        className={`cursor-pointer transition-colors ${
                          isSelected
                            ? 'bg-slate-100/80'
                            : needsUpiVerify
                              ? 'bg-amber-50/50 hover:bg-amber-50'
                              : 'hover:bg-slate-50/60'
                        }`}
                      >
                        <td className="py-3.5 px-5 whitespace-nowrap">
                          <p className="font-mono text-xs font-semibold text-slate-900 tabular-nums">
                            {order.order_number}
                          </p>
                          <p className="text-[11px] text-slate-500 mt-0.5">
                            {formatTimeAgo(createdDate)} · {order.source === 'guest' ? 'Storefront' : 'Server'}
                          </p>
                        </td>
                        <td className="py-3.5 px-4">
                          <p className="font-medium text-slate-900 truncate max-w-[160px]">
                            {order.customer_name}
                          </p>
                          <p className="text-xs text-slate-500">{order.table_or_room}</p>
                        </td>
                        <td className="py-3.5 px-4 whitespace-nowrap">
                          {needsUpiVerify ? (
                            <div>
                              <p className="text-xs font-semibold text-amber-800">
                                Verify UPI Payment
                              </p>
                              <p className="font-mono text-[11px] text-amber-700 tabular-nums">
                                UTR: {order.utr_number || 'Not provided'}
                              </p>
                            </div>
                          ) : payStatus === 'paid' ? (
                            <span className="text-xs font-semibold text-emerald-700">
                              {payMethod === 'upi' ? 'UPI' : 'Cash'} · Paid
                            </span>
                          ) : (
                            <span className="text-xs text-slate-500">Cash · Unpaid</span>
                          )}
                        </td>
                        <td className="py-3.5 px-4 whitespace-nowrap">
                          <span className={`text-xs ${STATUS_STYLE[order.status]}`}>
                            {STATUS_LABEL[order.status]}
                          </span>
                        </td>
                        <td className="py-3.5 px-5 text-right font-mono text-sm font-medium text-slate-900 tabular-nums whitespace-nowrap">
                          {formatCurrency(order.total_amount)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Selected Order Detail Inspector */}
            <div className="lg:col-span-4 p-5 bg-slate-50/40">
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
                    </div>
                    <span className={`text-xs ${STATUS_STYLE[activeOrder.status]}`}>
                      {STATUS_LABEL[activeOrder.status]}
                    </span>
                  </div>

                  {/* Payment Verification Box */}
                  {(() => {
                    const pMethod = getEffectivePaymentMethod(activeOrder.payment_method);
                    const pStatus = getEffectivePaymentStatus(
                      activeOrder.payment_status,
                      activeOrder.status
                    );
                    const isNeedsVerify =
                      pMethod === 'upi' && pStatus === 'verification_pending';
                    const busy = confirmingPaymentId === activeOrder.id;

                    if (isNeedsVerify) {
                      return (
                        <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg space-y-2.5">
                          <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-900">
                            <QrCode className="w-3.5 h-3.5 text-amber-700 shrink-0" />
                            <span>Verify UPI Payment</span>
                          </div>
                          <p className="font-mono text-xs text-amber-800 break-all tabular-nums">
                            UTR: {activeOrder.utr_number || 'Not provided by guest'}
                          </p>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void handleConfirmOrderPaid(activeOrder)}
                            className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold text-white bg-amber-700 hover:bg-amber-800 disabled:opacity-60 rounded-lg transition-colors cursor-pointer"
                          >
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            {busy ? 'Confirming...' : 'Confirm Paid'}
                          </button>
                        </div>
                      );
                    }

                    return (
                      <div className="p-3 bg-white border border-slate-200 rounded-lg flex items-center justify-between gap-3">
                        <div>
                          <p className="text-[11px] text-slate-500">Payment</p>
                          <p
                            className={`text-xs font-semibold mt-0.5 ${
                              pStatus === 'paid' ? 'text-emerald-700' : 'text-slate-700'
                            }`}
                          >
                            {pStatus === 'paid'
                              ? `Paid via ${pMethod === 'upi' ? 'UPI' : 'Cash'}`
                              : 'Cash at Counter · Unpaid'}
                          </p>
                          {activeOrder.utr_number && (
                            <p className="font-mono text-[11px] text-slate-500 mt-0.5 tabular-nums">
                              UTR: {activeOrder.utr_number}
                            </p>
                          )}
                        </div>
                        {pStatus !== 'paid' && (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void handleConfirmOrderPaid(activeOrder)}
                            className="px-3 py-1.5 text-xs font-semibold text-slate-800 bg-white border border-slate-300 hover:bg-slate-50 disabled:opacity-60 rounded-md whitespace-nowrap cursor-pointer"
                          >
                            {busy ? 'Saving...' : 'Confirm Paid'}
                          </button>
                        )}
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
                </div>
              ) : (
                <p className="text-xs text-slate-500">Select an order row to inspect line items.</p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
