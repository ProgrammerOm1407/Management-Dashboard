import React, { useMemo, useState } from 'react';
import {
  BedDouble,
  CalendarCheck2,
  CheckCircle2,
  KeyRound,
  Plus,
  QrCode,
  X,
} from 'lucide-react';
import { BookingStatus, Room, RoomBooking, RoomStatus, Shop } from '../../types';
import {
  confirmBookingPayment,
  createRoomBooking,
  updateBookingStatus,
  updateRoomStatus,
} from '../../lib/firestoreService';
import {
  addDaysIso,
  dateRangesOverlap,
  diffNights,
  formatShortDate,
  getTodayIso,
  isActiveBookingStatus,
} from '../../lib/dateUtils';
import { getEffectivePaymentMethod, getEffectivePaymentStatus } from '../../lib/upi';
import { formatCurrency } from '../../lib/validation';
import { useToast } from '../../context/ToastContext';

interface FrontDeskPanelProps {
  shop: Shop;
  rooms: Room[];
  bookings: RoomBooking[];
  loading: boolean;
  canSettlePayment?: boolean;
}

type DeskFilter = 'today' | 'pending' | 'in_house' | 'all';

const ROOM_STATUS_TEXT: Record<RoomStatus, string> = {
  available: 'text-emerald-700',
  occupied: 'text-blue-700',
  maintenance: 'text-red-700',
};

const BOOKING_STATUS_LABEL: Record<BookingStatus, string> = {
  pending: 'Pending Request',
  confirmed: 'Confirmed',
  checked_in: 'In-House',
  checked_out: 'Checked Out',
  cancelled: 'Cancelled',
};

const BOOKING_STATUS_TEXT: Record<BookingStatus, string> = {
  pending: 'text-amber-700 font-semibold',
  confirmed: 'text-blue-700 font-semibold',
  checked_in: 'text-emerald-700 font-semibold',
  checked_out: 'text-slate-500 font-medium',
  cancelled: 'text-red-700 font-medium',
};

export const FrontDeskPanel: React.FC<FrontDeskPanelProps> = ({
  shop,
  rooms,
  bookings,
  loading,
  canSettlePayment = false,
}) => {
  const { pushToast } = useToast();
  const todayIso = useMemo(() => getTodayIso(), []);
  const [filter, setFilter] = useState<DeskFilter>('today');
  const [busyBookingId, setBusyBookingId] = useState<string | null>(null);
  const [confirmingPaymentId, setConfirmingPaymentId] = useState<string | null>(null);
  const [busyRoomId, setBusyRoomId] = useState<string | null>(null);

  // Quick Walk-in Reservation Modal
  const [walkInOpen, setWalkInOpen] = useState(false);
  const [walkInRoomId, setWalkInRoomId] = useState('');
  const [guestName, setGuestName] = useState('');
  const [guestContact, setGuestContact] = useState('');
  const [checkIn, setCheckIn] = useState(todayIso);
  const [checkOut, setCheckOut] = useState(addDaysIso(todayIso, 1));
  const [notes, setNotes] = useState('');
  const [savingWalkIn, setSavingWalkIn] = useState(false);
  const [walkInError, setWalkInError] = useState<string | null>(null);

  const summary = useMemo(() => {
    const pendingRequests = bookings.filter((b) => b.status === 'pending').length;
    const arrivalsToday = bookings.filter(
      (b) => b.check_in === todayIso && (b.status === 'confirmed' || b.status === 'pending')
    ).length;
    const departuresToday = bookings.filter(
      (b) => b.check_out === todayIso && b.status === 'checked_in'
    ).length;
    const roomsAvailable = rooms.filter((r) => r.status === 'available').length;
    return { pendingRequests, arrivalsToday, departuresToday, roomsAvailable };
  }, [bookings, rooms, todayIso]);

  const filteredBookings = useMemo(() => {
    switch (filter) {
      case 'today':
        return bookings.filter(
          (b) =>
            b.status === 'pending' ||
            (b.status !== 'cancelled' &&
              getEffectivePaymentMethod(b.payment_method) === 'upi' &&
              getEffectivePaymentStatus(b.payment_status) === 'verification_pending') ||
            (b.check_in === todayIso && b.status === 'confirmed') ||
            (b.check_out === todayIso && b.status === 'checked_in') ||
            b.status === 'checked_in'
        );
      case 'pending':
        return bookings.filter((b) => b.status === 'pending');
      case 'in_house':
        return bookings.filter((b) => b.status === 'checked_in');
      case 'all':
        return bookings;
    }
  }, [bookings, filter, todayIso]);

  const handleBookingTransition = async (booking: RoomBooking, nextStatus: BookingStatus) => {
    setBusyBookingId(booking.id);
    try {
      await updateBookingStatus(shop.id, booking.id, nextStatus, booking.room_id);
      pushToast(
        `${booking.guest_name} · Room ${booking.room_number}`,
        `Booking updated to ${BOOKING_STATUS_LABEL[nextStatus]}.`,
        'success'
      );
    } catch (err) {
      pushToast(
        'Update failed',
        err instanceof Error ? err.message : 'Unable to update booking status.',
        'error'
      );
    } finally {
      setBusyBookingId(null);
    }
  };

  const handleConfirmBookingPaid = async (booking: RoomBooking) => {
    setConfirmingPaymentId(booking.id);
    try {
      await confirmBookingPayment(shop.id, booking.id);
      const methodLabel =
        getEffectivePaymentMethod(booking.payment_method) === 'upi' ? 'UPI' : 'Cash';
      pushToast(
        `Payment Confirmed (${methodLabel})`,
        `${booking.guest_name} · Room ${booking.room_number} (${formatCurrency(booking.total_price)}).`,
        'success'
      );
    } catch (err) {
      pushToast(
        'Payment verification failed',
        err instanceof Error ? err.message : 'Unable to confirm payment.',
        'error'
      );
    } finally {
      setConfirmingPaymentId(null);
    }
  };

  const handleRoomStatusUpdate = async (room: Room, nextStatus: RoomStatus) => {
    setBusyRoomId(room.id);
    try {
      await updateRoomStatus(shop.id, room.id, nextStatus);
      pushToast(
        `Room ${room.room_number} updated`,
        `Status set to ${nextStatus}.`,
        'info'
      );
    } catch (err) {
      pushToast(
        'Room update failed',
        err instanceof Error ? err.message : 'Unable to update room status.',
        'error'
      );
    } finally {
      setBusyRoomId(null);
    }
  };

  const openWalkInModal = () => {
    const avail = rooms.find((r) => r.status === 'available') || rooms[0];
    setWalkInRoomId(avail?.id || '');
    setGuestName('');
    setGuestContact('');
    setCheckIn(todayIso);
    setCheckOut(addDaysIso(todayIso, 1));
    setNotes('');
    setWalkInError(null);
    setWalkInOpen(true);
  };

  const handleCreateWalkIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setWalkInError(null);
    const room = rooms.find((r) => r.id === walkInRoomId);
    if (!room) {
      setWalkInError('Select a room.');
      return;
    }
    const nights = diffNights(checkIn, checkOut);
    if (nights <= 0) {
      setWalkInError('Check-out must be after check-in.');
      return;
    }
    const conflict = bookings.find(
      (b) =>
        b.room_id === room.id &&
        isActiveBookingStatus(b.status) &&
        dateRangesOverlap(checkIn, checkOut, b.check_in, b.check_out)
    );
    if (conflict) {
      setWalkInError(
        `Room ${room.room_number} already has an active stay overlapping ${checkIn} – ${checkOut}.`
      );
      return;
    }

    setSavingWalkIn(true);
    try {
      await createRoomBooking(shop.id, {
        room_id: room.id,
        room_number: room.room_number,
        guest_name: guestName,
        guest_contact: guestContact,
        check_in: checkIn,
        check_out: checkOut,
        total_price: nights * room.nightly_rate,
        notes,
        initial_status: 'confirmed',
      });
      pushToast('Walk-in booked', `${guestName.trim()} confirmed for Room ${room.room_number}.`, 'success');
      setWalkInOpen(false);
    } catch (err) {
      setWalkInError(err instanceof Error ? err.message : 'Unable to create reservation.');
    } finally {
      setSavingWalkIn(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-5">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((n) => (
            <div key={n} className="h-24 bg-white border border-slate-200 rounded-lg animate-pulse" />
          ))}
        </div>
        <div className="h-72 bg-white border border-slate-200 rounded-lg animate-pulse" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-lg font-semibold text-slate-900">
            Front Desk & Reception
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Manage today’s arrivals, departures, guest booking requests, and live room readiness.
          </p>
        </div>

        <button
          type="button"
          disabled={!shop.is_active || rooms.length === 0}
          onClick={openWalkInModal}
          className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white rounded-lg hover:opacity-95 disabled:opacity-50 whitespace-nowrap self-start sm:self-auto cursor-pointer"
          style={{ backgroundColor: shop.primary_color || '#0F172A' }}
        >
          <Plus className="w-4 h-4" />
          Walk-In Booking
        </button>
      </div>

      {/* 4-Column Front Desk Summary Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <p className="text-xs font-medium text-slate-500">Pending Requests</p>
          <p className="mt-1.5 font-mono text-2xl font-semibold text-amber-700 tabular-nums">
            {summary.pendingRequests}
          </p>
          <p className="mt-0.5 text-xs text-slate-500">Awaiting desk approval</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <p className="text-xs font-medium text-slate-500">Arrivals Today</p>
          <p className="mt-1.5 font-mono text-2xl font-semibold text-blue-700 tabular-nums">
            {summary.arrivalsToday}
          </p>
          <p className="mt-0.5 text-xs text-slate-500 font-mono tabular-nums">{todayIso}</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <p className="text-xs font-medium text-slate-500">Departures Today</p>
          <p className="mt-1.5 font-mono text-2xl font-semibold text-slate-900 tabular-nums">
            {summary.departuresToday}
          </p>
          <p className="mt-0.5 text-xs text-slate-500">Scheduled check-outs</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <p className="text-xs font-medium text-slate-500">Rooms Ready</p>
          <p className="mt-1.5 font-mono text-2xl font-semibold text-emerald-700 tabular-nums">
            {summary.roomsAvailable}
            <span className="text-sm font-normal text-slate-400"> / {rooms.length}</span>
          </p>
          <p className="mt-0.5 text-xs text-slate-500">Available for check-in</p>
        </div>
      </div>

      <div className="grid lg:grid-cols-12 gap-6 items-start">
        {/* Reservations Desk Queue */}
        <div className="lg:col-span-8 bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="p-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <KeyRound className="w-4 h-4 text-slate-500" />
              <h3 className="font-display text-sm font-semibold text-slate-900">
                Check-Ins, Check-Outs & Requests
              </h3>
            </div>

            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg overflow-x-auto max-w-full">
              {(
                [
                  { id: 'today', label: 'Today & Active' },
                  { id: 'pending', label: `Pending (${summary.pendingRequests})` },
                  { id: 'in_house', label: 'In-House' },
                  { id: 'all', label: 'All' },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setFilter(tab.id)}
                  className={`px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    filter === tab.id
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          {filteredBookings.length === 0 ? (
            <div className="px-6 py-12 text-center">
              <CalendarCheck2 className="w-8 h-8 text-slate-300 mx-auto mb-2.5" />
              <p className="text-sm font-medium text-slate-900">No reservations in this queue</p>
              <p className="text-xs text-slate-500 mt-1">
                New guest booking requests and scheduled arrivals appear here in real time.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-slate-200">
              {filteredBookings.map((b) => {
                const busy = busyBookingId === b.id;
                const payBusy = confirmingPaymentId === b.id;
                const nights = Math.max(1, diffNights(b.check_in, b.check_out));
                const isArrivingToday = b.check_in === todayIso && b.status !== 'checked_in';
                const isDepartingToday = b.check_out === todayIso && b.status === 'checked_in';
                const payMethod = getEffectivePaymentMethod(b.payment_method);
                const payStatus = getEffectivePaymentStatus(b.payment_status);
                const needsUpiVerify =
                  b.status !== 'cancelled' &&
                  payMethod === 'upi' &&
                  payStatus === 'verification_pending';
                const canConfirmPaid = b.status !== 'cancelled' && payStatus !== 'paid';
                return (
                  <div
                    key={b.id}
                    className={`p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 ${
                      needsUpiVerify ? 'bg-amber-50/50 hover:bg-amber-50' : 'hover:bg-slate-50/50'
                    }`}
                  >
                    <div className="space-y-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2 text-sm">
                        <span className="font-semibold text-slate-900">{b.guest_name}</span>
                        <span className="text-slate-300">·</span>
                        <span className="font-mono text-xs font-medium text-slate-700">
                          Room {b.room_number}
                        </span>
                        <span className="text-slate-300">·</span>
                        <span className={`text-xs ${BOOKING_STATUS_TEXT[b.status]}`}>
                          {BOOKING_STATUS_LABEL[b.status]}
                        </span>
                        {isArrivingToday && (
                          <>
                            <span className="text-slate-300">·</span>
                            <span className="text-xs font-medium text-blue-700">Arriving today</span>
                          </>
                        )}
                        {isDepartingToday && (
                          <>
                            <span className="text-slate-300">·</span>
                            <span className="text-xs font-medium text-amber-700">
                              Checking out today
                            </span>
                          </>
                        )}
                      </div>
                      <p className="text-xs text-slate-500 font-mono tabular-nums">
                        {formatShortDate(b.check_in)} → {formatShortDate(b.check_out)} ({nights}{' '}
                        {nights === 1 ? 'nt' : 'nts'}) · {b.guest_contact} ·{' '}
                        {formatCurrency(b.total_price)}
                      </p>

                      {needsUpiVerify ? (
                        <div className="flex flex-wrap items-center gap-1.5 text-xs font-semibold text-amber-800 pt-0.5">
                          <QrCode className="w-3.5 h-3.5 text-amber-700 shrink-0" />
                          <span>Verify UPI Payment</span>
                          <span className="text-amber-400">·</span>
                          <span className="font-mono font-normal text-amber-900 tabular-nums">
                            UTR: {b.utr_number || 'Not provided'}
                          </span>
                        </div>
                      ) : payStatus === 'paid' ? (
                        <div className="flex flex-wrap items-center gap-1.5 text-xs font-semibold text-emerald-700 pt-0.5">
                          <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                          <span>Paid via {payMethod === 'upi' ? 'UPI' : 'Cash'}</span>
                          {b.utr_number && (
                            <span className="font-mono font-normal text-slate-500 tabular-nums">
                              · UTR {b.utr_number}
                            </span>
                          )}
                        </div>
                      ) : (
                        <p className="text-[11px] text-slate-500">Cash at Counter · Unpaid</p>
                      )}

                      {b.notes && (
                        <p className="text-xs text-slate-600">Note: {b.notes}</p>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      {canConfirmPaid && canSettlePayment ? (
                        <button
                          type="button"
                          disabled={payBusy}
                          onClick={() => void handleConfirmBookingPaid(b)}
                          className={`inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold rounded-md disabled:opacity-50 whitespace-nowrap cursor-pointer ${
                            needsUpiVerify
                              ? 'text-white bg-amber-700 hover:bg-amber-800'
                              : 'text-emerald-800 bg-white border border-emerald-300 hover:bg-emerald-50'
                          }`}
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          {payBusy ? 'Confirming...' : 'Confirm Paid'}
                        </button>
                      ) : canConfirmPaid && needsUpiVerify ? (
                        <span className="text-[11px] font-medium text-amber-800 whitespace-nowrap">
                          Owner confirmation required
                        </span>
                      ) : null}

                      {b.status === 'pending' && (
                        <>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void handleBookingTransition(b, 'confirmed')}
                            className="px-3 py-1.5 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-md disabled:opacity-50 whitespace-nowrap cursor-pointer"
                          >
                            Confirm
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void handleBookingTransition(b, 'cancelled')}
                            className="px-3 py-1.5 text-xs font-medium text-red-700 bg-white border border-red-200 hover:bg-red-50 rounded-md disabled:opacity-50 whitespace-nowrap cursor-pointer"
                          >
                            Cancel
                          </button>
                        </>
                      )}
                      {b.status === 'confirmed' && (
                        <>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void handleBookingTransition(b, 'checked_in')}
                            className="px-3 py-1.5 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-md disabled:opacity-50 whitespace-nowrap cursor-pointer"
                          >
                            Check-In
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void handleBookingTransition(b, 'cancelled')}
                            className="px-3 py-1.5 text-xs font-medium text-red-700 bg-white border border-red-200 hover:bg-red-50 rounded-md disabled:opacity-50 whitespace-nowrap cursor-pointer"
                          >
                            Cancel
                          </button>
                        </>
                      )}
                      {b.status === 'checked_in' && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void handleBookingTransition(b, 'checked_out')}
                          className="px-3 py-1.5 text-xs font-semibold text-slate-800 bg-white border border-slate-300 hover:bg-slate-50 rounded-md disabled:opacity-50 whitespace-nowrap cursor-pointer"
                        >
                          Check-Out
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Live Room Status Board */}
        <div className="lg:col-span-4 bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="p-4 border-b border-slate-200 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <BedDouble className="w-4 h-4 text-slate-500" />
              <h3 className="font-display text-sm font-semibold text-slate-900">Room Status</h3>
            </div>
            <span className="font-mono text-xs text-slate-500 tabular-nums">
              {rooms.length} {rooms.length === 1 ? 'room' : 'rooms'}
            </span>
          </div>

          {rooms.length === 0 ? (
            <div className="p-6 text-center text-xs text-slate-500">
              No rooms configured yet.
            </div>
          ) : (
            <div className="divide-y divide-slate-200">
              {rooms.map((room) => (
                <div key={room.id} className="p-3.5 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-mono text-xs font-semibold text-slate-900">
                      Room {room.room_number}
                    </p>
                    <p className="text-xs text-slate-600 truncate">{room.title}</p>
                    <p className="text-[11px] text-slate-500 font-mono tabular-nums">
                      {room.room_type} · {formatCurrency(room.nightly_rate)}/nt
                    </p>
                  </div>

                  <select
                    aria-label={`Status for Room ${room.room_number}`}
                    disabled={busyRoomId === room.id}
                    value={room.status}
                    onChange={(e) =>
                      void handleRoomStatusUpdate(room, e.target.value as RoomStatus)
                    }
                    className={`text-xs font-semibold bg-slate-50 border border-slate-200 rounded-md px-2.5 py-1.5 focus:outline-none disabled:opacity-50 cursor-pointer shrink-0 ${ROOM_STATUS_TEXT[room.status]}`}
                  >
                    <option value="available">Available</option>
                    <option value="occupied">Occupied</option>
                    <option value="maintenance">Maintenance</option>
                  </select>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Walk-In Booking Modal */}
      {walkInOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="fixed inset-0 bg-slate-950/40 backdrop-blur-[1px]"
            onClick={() => setWalkInOpen(false)}
          />
          <div className="relative z-10 w-full max-w-md bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <h3 className="font-display text-base font-semibold text-slate-900">
                New Walk-In Booking
              </h3>
              <button
                type="button"
                onClick={() => setWalkInOpen(false)}
                className="p-1.5 text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={(e) => void handleCreateWalkIn(e)} className="p-6 space-y-4">
              {walkInError && (
                <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
                  {walkInError}
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Room</label>
                <select
                  required
                  value={walkInRoomId}
                  onChange={(e) => setWalkInRoomId(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white focus:border-blue-600 focus:outline-none"
                >
                  {rooms.map((r) => (
                    <option key={r.id} value={r.id}>
                      Room {r.room_number} — {r.title} ({formatCurrency(r.nightly_rate)}/nt)
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Guest Name</label>
                <input
                  type="text"
                  required
                  maxLength={100}
                  value={guestName}
                  onChange={(e) => setGuestName(e.target.value)}
                  placeholder="Guest full name"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:border-blue-600 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Guest Phone</label>
                <input
                  type="text"
                  required
                  maxLength={120}
                  value={guestContact}
                  onChange={(e) => setGuestContact(e.target.value)}
                  placeholder="+91 98765 43210"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:border-blue-600 focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Check-In</label>
                  <input
                    type="date"
                    required
                    value={checkIn}
                    onChange={(e) => {
                      const val = e.target.value;
                      setCheckIn(val);
                      if (checkOut <= val) setCheckOut(addDaysIso(val, 1));
                    }}
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg focus:border-blue-600 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Check-Out</label>
                  <input
                    type="date"
                    required
                    min={addDaysIso(checkIn, 1)}
                    value={checkOut}
                    onChange={(e) => setCheckOut(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg focus:border-blue-600 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Notes (Optional)
                </label>
                <textarea
                  rows={2}
                  maxLength={300}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="ID verified, early check-in, extra bed..."
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:border-blue-600 focus:outline-none resize-none"
                />
              </div>

              <div className="pt-3 border-t border-slate-200 flex justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setWalkInOpen(false)}
                  className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingWalkIn}
                  className="px-4 py-2 text-xs font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 disabled:opacity-60 cursor-pointer"
                >
                  {savingWalkIn ? 'Booking...' : 'Confirm Walk-In'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
