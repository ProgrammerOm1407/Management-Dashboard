import React, { useMemo, useState } from 'react';
import {
  BedDouble,
  Calendar,
  CalendarCheck2,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Edit2,
  List,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import { BookingStatus, Room, RoomBooking, RoomStatus, Shop } from '../../types';
import {
  confirmBookingPayment,
  createRoom,
  createRoomBooking,
  deleteRoom,
  updateBookingStatus,
  updateRoom,
  updateRoomStatus,
} from '../../lib/firestoreService';
import {
  addDaysIso,
  dateRangesOverlap,
  diffNights,
  formatDayHeader,
  formatShortDate,
  getTodayIso,
  isActiveBookingStatus,
} from '../../lib/dateUtils';
import { getEffectivePaymentMethod, getEffectivePaymentStatus } from '../../lib/upi';
import { formatCurrency } from '../../lib/validation';
import { SafeImage } from '../SafeImage';
import { useToast } from '../../context/ToastContext';

interface RoomsManagerProps {
  shop: Shop;
  rooms: Room[];
  bookings: RoomBooking[];
  loading: boolean;
}

const ROOM_STATUS_COLOR: Record<RoomStatus, string> = {
  available: 'text-emerald-700',
  occupied: 'text-blue-700',
  maintenance: 'text-red-700',
};

const BOOKING_STATUS_LABEL: Record<BookingStatus, string> = {
  pending: 'Pending',
  confirmed: 'Confirmed',
  checked_in: 'Checked In',
  checked_out: 'Checked Out',
  cancelled: 'Cancelled',
};

const BOOKING_STATUS_COLOR: Record<BookingStatus, string> = {
  pending: 'text-amber-700 font-semibold',
  confirmed: 'text-blue-700 font-semibold',
  checked_in: 'text-emerald-700 font-semibold',
  checked_out: 'text-slate-500 font-medium',
  cancelled: 'text-red-700 font-medium',
};

const CALENDAR_BAR_COLOR: Record<BookingStatus, string> = {
  pending: 'bg-amber-100 border-amber-300 text-amber-900',
  confirmed: 'bg-blue-100 border-blue-300 text-blue-900',
  checked_in: 'bg-emerald-100 border-emerald-300 text-emerald-900',
  checked_out: 'bg-slate-100 border-slate-300 text-slate-600',
  cancelled: 'bg-red-50 border-red-200 text-red-700',
};

export const RoomsManager: React.FC<RoomsManagerProps> = ({
  shop,
  rooms,
  bookings,
  loading,
}) => {
  const { pushToast } = useToast();
  const [subTab, setSubTab] = useState<'inventory' | 'bookings'>('inventory');
  const [bookingViewMode, setBookingViewMode] = useState<'list' | 'calendar'>('list');
  const [bookingStatusFilter, setBookingStatusFilter] = useState<'all' | BookingStatus>('all');
  const [updatingBookingId, setUpdatingBookingId] = useState<string | null>(null);
  const [confirmingPaymentId, setConfirmingPaymentId] = useState<string | null>(null);

  // Calendar 14-day window state
  const [calendarStart, setCalendarStart] = useState<string>(() => getTodayIso());
  const [selectedCalBookingId, setSelectedCalBookingId] = useState<string | null>(null);

  // Room Modal State
  const [roomModalOpen, setRoomModalOpen] = useState(false);
  const [editingRoom, setEditingRoom] = useState<Room | null>(null);
  const [roomNumber, setRoomNumber] = useState('');
  const [title, setTitle] = useState('');
  const [roomType, setRoomType] = useState('Deluxe');
  const [nightlyRate, setNightlyRate] = useState('');
  const [capacity, setCapacity] = useState('2');
  const [status, setStatus] = useState<RoomStatus>('available');
  const [amenitiesText, setAmenitiesText] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [savingRoom, setSavingRoom] = useState(false);
  const [roomError, setRoomError] = useState<string | null>(null);

  // Booking Modal State
  const [bookingModalOpen, setBookingModalOpen] = useState(false);
  const [bookingRoomId, setBookingRoomId] = useState('');
  const [guestName, setGuestName] = useState('');
  const [guestContact, setGuestContact] = useState('');
  const [checkIn, setCheckIn] = useState('');
  const [checkOut, setCheckOut] = useState('');
  const [bookingNotes, setBookingNotes] = useState('');
  const [savingBooking, setSavingBooking] = useState(false);
  const [bookingError, setBookingError] = useState<string | null>(null);

  const pendingCount = useMemo(
    () => bookings.filter((b) => b.status === 'pending').length,
    [bookings]
  );

  const bookingCounts = useMemo(() => {
    const counts: Record<'all' | BookingStatus, number> = {
      all: bookings.length,
      pending: 0,
      confirmed: 0,
      checked_in: 0,
      checked_out: 0,
      cancelled: 0,
    };
    bookings.forEach((b) => {
      counts[b.status] += 1;
    });
    return counts;
  }, [bookings]);

  const filteredBookings = useMemo(() => {
    if (bookingStatusFilter === 'all') return bookings;
    return bookings.filter((b) => b.status === bookingStatusFilter);
  }, [bookings, bookingStatusFilter]);

  const calendarDays = useMemo(() => {
    return Array.from({ length: 14 }, (_, idx) => addDaysIso(calendarStart, idx));
  }, [calendarStart]);

  const selectedCalendarBooking = useMemo(
    () => bookings.find((b) => b.id === selectedCalBookingId) || null,
    [bookings, selectedCalBookingId]
  );

  const modalNights = useMemo(() => Math.max(0, diffNights(checkIn, checkOut)), [checkIn, checkOut]);
  const modalSelectedRoom = useMemo(
    () => rooms.find((r) => r.id === bookingRoomId) || null,
    [rooms, bookingRoomId]
  );
  const modalTotalEstimate = useMemo(() => {
    if (!modalSelectedRoom || modalNights <= 0) return 0;
    return modalNights * modalSelectedRoom.nightly_rate;
  }, [modalSelectedRoom, modalNights]);

  const openAddRoom = () => {
    setEditingRoom(null);
    setRoomNumber('');
    setTitle('');
    setRoomType('Deluxe');
    setNightlyRate('4500');
    setCapacity('2');
    setStatus('available');
    setAmenitiesText('Wi-Fi, Rain Shower, AC, Filter Coffee Bar');
    setImageUrl('');
    setRoomError(null);
    setRoomModalOpen(true);
  };

  const openEditRoom = (room: Room) => {
    setEditingRoom(room);
    setRoomNumber(room.room_number);
    setTitle(room.title);
    setRoomType(room.room_type);
    setNightlyRate(String(room.nightly_rate));
    setCapacity(String(room.capacity));
    setStatus(room.status);
    setAmenitiesText(room.amenities.join(', '));
    setImageUrl(room.image_url);
    setRoomError(null);
    setRoomModalOpen(true);
  };

  const handleSaveRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    setRoomError(null);
    setSavingRoom(true);
    try {
      const payload = {
        room_number: roomNumber,
        title,
        room_type: roomType,
        nightly_rate: Number(nightlyRate),
        capacity: Number(capacity),
        status,
        amenities: amenitiesText
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        image_url: imageUrl,
      };
      if (editingRoom) {
        await updateRoom(shop.id, editingRoom.id, payload);
        pushToast('Room updated', `Room ${roomNumber} saved.`, 'success');
      } else {
        await createRoom(shop.id, payload);
        pushToast('Room added', `Room ${roomNumber} added to inventory.`, 'success');
      }
      setRoomModalOpen(false);
    } catch (err) {
      setRoomError(err instanceof Error ? err.message : 'Unable to save room.');
    } finally {
      setSavingRoom(false);
    }
  };

  const handleQuickRoomStatus = async (room: Room, nextStatus: RoomStatus) => {
    try {
      await updateRoomStatus(shop.id, room.id, nextStatus);
      pushToast('Availability updated', `Room ${room.room_number} is now ${nextStatus}.`, 'info');
    } catch (err) {
      pushToast('Update failed', err instanceof Error ? err.message : 'Try again.', 'error');
    }
  };

  const handleDeleteRoom = async (room: Room) => {
    try {
      await deleteRoom(shop.id, room.id);
      pushToast('Room deleted', `Room ${room.room_number} removed.`, 'info');
    } catch (err) {
      pushToast('Delete failed', err instanceof Error ? err.message : 'Try again.', 'error');
    }
  };

  const openBookingModal = () => {
    const firstAvailable = rooms.find((r) => r.status === 'available') || rooms[0];
    setBookingRoomId(firstAvailable?.id || '');
    setGuestName('');
    setGuestContact('');
    const today = getTodayIso();
    setCheckIn(today);
    setCheckOut(addDaysIso(today, 1));
    setBookingNotes('');
    setBookingError(null);
    setBookingModalOpen(true);
  };

  const handleCreateBooking = async (e: React.FormEvent) => {
    e.preventDefault();
    setBookingError(null);
    const selectedRoom = rooms.find((r) => r.id === bookingRoomId);
    if (!selectedRoom) {
      setBookingError('Please select a room.');
      return;
    }
    const nights = diffNights(checkIn, checkOut);
    if (nights <= 0) {
      setBookingError('Check-out date must be at least 1 night after check-in.');
      return;
    }

    const conflict = bookings.find(
      (b) =>
        b.room_id === selectedRoom.id &&
        isActiveBookingStatus(b.status) &&
        dateRangesOverlap(checkIn, checkOut, b.check_in, b.check_out)
    );
    if (conflict) {
      setBookingError(
        `Room ${selectedRoom.room_number} already has an active reservation (${conflict.check_in} to ${conflict.check_out}) overlapping these dates.`
      );
      return;
    }

    const totalPrice = nights * selectedRoom.nightly_rate;

    setSavingBooking(true);
    try {
      await createRoomBooking(shop.id, {
        room_id: selectedRoom.id,
        room_number: selectedRoom.room_number,
        guest_name: guestName,
        guest_contact: guestContact,
        check_in: checkIn,
        check_out: checkOut,
        total_price: totalPrice,
        notes: bookingNotes,
        initial_status: 'confirmed',
      });
      pushToast(
        'Reservation confirmed',
        `${guestName.trim()} booked into Room ${selectedRoom.room_number}.`,
        'success'
      );
      setBookingModalOpen(false);
    } catch (err) {
      setBookingError(err instanceof Error ? err.message : 'Unable to create booking.');
    } finally {
      setSavingBooking(false);
    }
  };

  const handleBookingStatusChange = async (booking: RoomBooking, nextStatus: BookingStatus) => {
    setUpdatingBookingId(booking.id);
    try {
      await updateBookingStatus(shop.id, booking.id, nextStatus, booking.room_id);
      pushToast(
        'Booking updated',
        `${booking.guest_name} (Room ${booking.room_number}) marked ${BOOKING_STATUS_LABEL[nextStatus]}.`,
        'info'
      );
    } catch (err) {
      pushToast('Update failed', err instanceof Error ? err.message : 'Try again.', 'error');
    } finally {
      setUpdatingBookingId(null);
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
        `${booking.guest_name} (Room ${booking.room_number}) · ${formatCurrency(booking.total_price)} settled.`,
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

  const renderBookingActions = (b: RoomBooking) => {
    const busy = updatingBookingId === b.id;
    const payBusy = confirmingPaymentId === b.id;
    const payMethod = getEffectivePaymentMethod(b.payment_method);
    const payStatus = getEffectivePaymentStatus(b.payment_status);
    const needsUpiVerify =
      b.status !== 'cancelled' && payMethod === 'upi' && payStatus === 'verification_pending';
    const canConfirmPaid = b.status !== 'cancelled' && payStatus !== 'paid';

    const paymentButton = canConfirmPaid ? (
      <button
        type="button"
        disabled={payBusy}
        onClick={() => void handleConfirmBookingPaid(b)}
        className={`inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold rounded-md disabled:opacity-50 whitespace-nowrap cursor-pointer ${
          needsUpiVerify
            ? 'text-white bg-amber-700 hover:bg-amber-800'
            : 'text-emerald-800 bg-white border border-emerald-300 hover:bg-emerald-50'
        }`}
      >
        <CheckCircle2 className="w-3.5 h-3.5" />
        {payBusy ? 'Confirming...' : 'Confirm Paid'}
      </button>
    ) : null;

    if (b.status === 'pending') {
      return (
        <div className="inline-flex flex-wrap items-center justify-end gap-1.5">
          {paymentButton}
          <button
            type="button"
            disabled={busy}
            onClick={() => void handleBookingStatusChange(b, 'confirmed')}
            className="px-2.5 py-1.5 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-md disabled:opacity-50 whitespace-nowrap cursor-pointer"
          >
            Confirm
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void handleBookingStatusChange(b, 'cancelled')}
            className="px-2.5 py-1.5 text-xs font-medium text-red-700 bg-white border border-red-200 hover:bg-red-50 rounded-md disabled:opacity-50 whitespace-nowrap cursor-pointer"
          >
            Cancel
          </button>
        </div>
      );
    }
    if (b.status === 'confirmed') {
      return (
        <div className="inline-flex flex-wrap items-center justify-end gap-1.5">
          {paymentButton}
          <button
            type="button"
            disabled={busy}
            onClick={() => void handleBookingStatusChange(b, 'checked_in')}
            className="px-2.5 py-1.5 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-md disabled:opacity-50 whitespace-nowrap cursor-pointer"
          >
            Check-In
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void handleBookingStatusChange(b, 'cancelled')}
            className="px-2.5 py-1.5 text-xs font-medium text-red-700 bg-white border border-red-200 hover:bg-red-50 rounded-md disabled:opacity-50 whitespace-nowrap cursor-pointer"
          >
            Cancel
          </button>
        </div>
      );
    }
    if (b.status === 'checked_in') {
      return (
        <div className="inline-flex flex-wrap items-center justify-end gap-1.5">
          {paymentButton}
          <button
            type="button"
            disabled={busy}
            onClick={() => void handleBookingStatusChange(b, 'checked_out')}
            className="px-3 py-1.5 text-xs font-semibold text-slate-800 bg-white border border-slate-300 hover:bg-slate-50 rounded-md disabled:opacity-50 whitespace-nowrap cursor-pointer"
          >
            Check-Out
          </button>
        </div>
      );
    }
    if (paymentButton) {
      return <div className="inline-flex items-center justify-end gap-1.5">{paymentButton}</div>;
    }
    return (
      <span className="text-xs text-slate-400">
        {b.status === 'checked_out' ? 'Completed' : 'Closed'}
      </span>
    );
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-lg font-semibold text-stone-950 tracking-tight">
            Rooms & Reservations
          </h2>
          <p className="text-xs text-stone-500 mt-0.5">
            Manage room inventory, nightly rates, and incoming guest booking requests for{' '}
            {shop.name}.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 self-start sm:self-auto">
          <div className="flex items-center gap-1 p-1 glass-segmented rounded-2xl">
            <button
              type="button"
              onClick={() => setSubTab('inventory')}
              className={`px-3 py-1.5 text-xs font-medium rounded-xl transition-all whitespace-nowrap cursor-pointer ${
                subTab === 'inventory'
                  ? 'bg-white/95 text-stone-950 shadow-xs'
                  : 'text-stone-600 hover:text-stone-950'
              }`}
            >
              Rooms ({rooms.length})
            </button>
            <button
              type="button"
              onClick={() => setSubTab('bookings')}
              className={`px-3 py-1.5 text-xs font-medium rounded-xl transition-all whitespace-nowrap cursor-pointer ${
                subTab === 'bookings'
                  ? 'bg-white/95 text-stone-950 shadow-xs'
                  : 'text-stone-600 hover:text-stone-950'
              }`}
            >
              Bookings ({bookings.length}
              {pendingCount > 0 ? ` · ${pendingCount} pending` : ''})
            </button>
          </div>

          {subTab === 'inventory' ? (
            <button
              type="button"
              onClick={openAddRoom}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white rounded-lg whitespace-nowrap cursor-pointer"
              style={{ backgroundColor: shop.primary_color || '#0F172A' }}
            >
              <Plus className="w-4 h-4" />
              Add Room
            </button>
          ) : (
            <button
              type="button"
              disabled={rooms.length === 0}
              onClick={openBookingModal}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white rounded-lg disabled:opacity-50 whitespace-nowrap cursor-pointer"
              style={{ backgroundColor: shop.primary_color || '#0F172A' }}
            >
              <Plus className="w-4 h-4" />
              New Booking
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-56 surface-card rounded-2xl animate-pulse" />
          ))}
        </div>
      ) : subTab === 'inventory' ? (
        rooms.length === 0 ? (
          <div className="surface-card rounded-2xl px-6 py-14 text-center">
            <BedDouble className="w-8 h-8 text-stone-300 mx-auto mb-3" />
            <h3 className="text-base font-semibold text-stone-950">No rooms configured</h3>
            <p className="mt-1.5 text-sm text-stone-600 max-w-md mx-auto">
              Add rooms and suites so guests can check date availability and submit booking requests
              on your public link.
            </p>
            <button
              type="button"
              onClick={openAddRoom}
              className="mt-5 inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-stone-900 rounded-lg hover:bg-stone-800 cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              Add First Room
            </button>
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {rooms.map((room) => (
              <div
                key={room.id}
                className="group surface-card-interactive rounded-2xl overflow-hidden flex flex-col"
              >
                <div className="overflow-hidden border-b border-stone-200/80">
                  <SafeImage
                    src={room.image_url}
                    alt={room.title}
                    fallbackIcon="room"
                    fallbackLabel={`Room ${room.room_number}`}
                    accentColor={shop.primary_color}
                    className="w-full h-44 object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                  />
                </div>
                <div className="p-4 flex-1 flex flex-col justify-between gap-4">
                  <div>
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-mono text-xs text-slate-500">
                          Room {room.room_number} · {room.room_type}
                        </p>
                        <h3 className="font-display text-base font-semibold text-slate-900 mt-0.5">
                          {room.title}
                        </h3>
                      </div>
                      <p className="font-mono text-sm font-semibold text-slate-900 tabular-nums shrink-0">
                        {formatCurrency(room.nightly_rate)}
                        <span className="text-[11px] font-normal text-slate-500">/nt</span>
                      </p>
                    </div>
                    <p className="mt-2 text-xs text-slate-500">
                      Up to {room.capacity} guests
                      {room.amenities.length > 0 ? ` · ${room.amenities.join(' · ')}` : ''}
                    </p>
                  </div>

                  <div className="pt-3 border-t border-slate-100 flex items-center justify-between gap-2">
                    <select
                      aria-label={`Availability for Room ${room.room_number}`}
                      value={room.status}
                      onChange={(e) =>
                        void handleQuickRoomStatus(room, e.target.value as RoomStatus)
                      }
                      className={`text-xs font-semibold bg-slate-50 border border-slate-200 rounded-md px-2.5 py-1.5 focus:outline-none cursor-pointer ${ROOM_STATUS_COLOR[room.status]}`}
                    >
                      <option value="available">Available</option>
                      <option value="occupied">Occupied</option>
                      <option value="maintenance">Maintenance</option>
                    </select>

                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => openEditRoom(room)}
                        aria-label={`Edit Room ${room.room_number}`}
                        className="p-1.5 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-md cursor-pointer"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDeleteRoom(room)}
                        aria-label={`Delete Room ${room.room_number}`}
                        className="p-1.5 text-slate-500 hover:text-red-700 hover:bg-red-50 rounded-md cursor-pointer"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )
      ) : (
        /* Bookings List + 14-Day Occupancy Calendar */
        <div className="surface-card rounded-2xl overflow-hidden">
          <div className="p-4 border-b border-stone-200/75 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
            <div className="flex items-center gap-1 p-1 glass-segmented rounded-xl overflow-x-auto max-w-full">
              {(['all', 'pending', 'confirmed', 'checked_in', 'checked_out', 'cancelled'] as const).map(
                (st) => (
                  <button
                    key={st}
                    type="button"
                    onClick={() => setBookingStatusFilter(st)}
                    className={`px-2.5 py-1.5 text-xs font-medium rounded-lg transition-all whitespace-nowrap shrink-0 flex items-center gap-1.5 cursor-pointer ${
                      bookingStatusFilter === st
                        ? 'bg-white/95 text-stone-950 shadow-xs'
                        : 'text-stone-600 hover:text-stone-950'
                    }`}
                  >
                    <span>{st === 'all' ? 'All' : BOOKING_STATUS_LABEL[st]}</span>
                    <span className="font-mono text-[11px] text-stone-400 tabular-nums">
                      {bookingCounts[st]}
                    </span>
                  </button>
                )
              )}
            </div>

            <div className="flex items-center gap-1 p-1 glass-segmented rounded-xl self-start lg:self-auto shrink-0">
              <button
                type="button"
                onClick={() => setBookingViewMode('list')}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-all whitespace-nowrap cursor-pointer ${
                  bookingViewMode === 'list'
                    ? 'bg-white/95 text-stone-950 shadow-xs'
                    : 'text-stone-600 hover:text-stone-950'
                }`}
              >
                <List className="w-3.5 h-3.5" />
                List View
              </button>
              <button
                type="button"
                onClick={() => setBookingViewMode('calendar')}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-all whitespace-nowrap cursor-pointer ${
                  bookingViewMode === 'calendar'
                    ? 'bg-white/95 text-stone-950 shadow-xs'
                    : 'text-stone-600 hover:text-stone-950'
                }`}
              >
                <Calendar className="w-3.5 h-3.5" />
                Calendar
              </button>
            </div>
          </div>

          {bookingViewMode === 'list' ? (
            filteredBookings.length === 0 ? (
              <div className="px-6 py-14 text-center">
                <CalendarCheck2 className="w-8 h-8 text-slate-300 mx-auto mb-3" />
                <h3 className="text-base font-semibold text-slate-900">
                  No reservations in this view
                </h3>
                <p className="mt-1.5 text-sm text-slate-600 max-w-md mx-auto">
                  Guest booking requests from <span className="font-mono">/s/{shop.slug}</span> and
                  direct front-desk reservations appear here automatically.
                </p>
                {rooms.length > 0 && (
                  <button
                    type="button"
                    onClick={openBookingModal}
                    className="mt-5 inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 cursor-pointer"
                  >
                    <Plus className="w-4 h-4" />
                    Create Booking
                  </button>
                )}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-stone-200/75 bg-stone-100/50 text-xs font-medium text-stone-500">
                      <th className="py-3 px-5">Guest</th>
                      <th className="py-3 px-4">Room</th>
                      <th className="py-3 px-4">Stay Dates</th>
                      <th className="py-3 px-4">Payment</th>
                      <th className="py-3 px-4">Status</th>
                      <th className="py-3 px-4 text-right">Total</th>
                      <th className="py-3 px-5 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100 text-sm">
                    {filteredBookings.map((b) => {
                      const nights = Math.max(1, diffNights(b.check_in, b.check_out));
                      const payMethod = getEffectivePaymentMethod(b.payment_method);
                      const payStatus = getEffectivePaymentStatus(b.payment_status);
                      const needsUpiVerify =
                        b.status !== 'cancelled' &&
                        payMethod === 'upi' &&
                        payStatus === 'verification_pending';
                      return (
                        <tr
                          key={b.id}
                          className={
                            needsUpiVerify
                              ? 'bg-amber-50/50 hover:bg-amber-50'
                              : 'hover:bg-slate-50/70'
                          }
                        >
                          <td className="py-3.5 px-5">
                            <p className="font-medium text-slate-900">{b.guest_name}</p>
                            <p className="text-xs text-slate-500 font-mono">{b.guest_contact}</p>
                          </td>
                          <td className="py-3.5 px-4 font-mono text-xs text-slate-700 whitespace-nowrap">
                            Room {b.room_number}
                          </td>
                          <td className="py-3.5 px-4 whitespace-nowrap">
                            <p className="font-mono text-xs text-slate-800 tabular-nums">
                              {formatShortDate(b.check_in)} → {formatShortDate(b.check_out)}
                            </p>
                            <p className="text-[11px] text-slate-500">
                              {nights} {nights === 1 ? 'night' : 'nights'}
                            </p>
                          </td>
                          <td className="py-3.5 px-4 whitespace-nowrap">
                            {needsUpiVerify ? (
                              <div>
                                <p className="text-xs font-semibold text-amber-800">
                                  Verify UPI Payment
                                </p>
                                <p className="font-mono text-[11px] text-amber-700 tabular-nums">
                                  UTR: {b.utr_number || 'Not provided'}
                                </p>
                              </div>
                            ) : payStatus === 'paid' ? (
                              <div>
                                <p className="text-xs font-semibold text-emerald-700">
                                  Paid via {payMethod === 'upi' ? 'UPI' : 'Cash'}
                                </p>
                                {b.utr_number && (
                                  <p className="font-mono text-[11px] text-slate-500 tabular-nums">
                                    UTR: {b.utr_number}
                                  </p>
                                )}
                              </div>
                            ) : (
                              <span className="text-xs text-slate-500">Cash · Unpaid</span>
                            )}
                          </td>
                          <td className="py-3.5 px-4 whitespace-nowrap">
                            <span className={`text-xs ${BOOKING_STATUS_COLOR[b.status]}`}>
                              {BOOKING_STATUS_LABEL[b.status]}
                            </span>
                          </td>
                          <td className="py-3.5 px-4 text-right font-mono text-sm font-medium text-slate-900 tabular-nums whitespace-nowrap">
                            {formatCurrency(b.total_price)}
                          </td>
                          <td className="py-3.5 px-5 text-right whitespace-nowrap">
                            {renderBookingActions(b)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )
          ) : (
            /* 14-Day Room Occupancy Calendar */
            <div className="p-4 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setCalendarStart((prev) => addDaysIso(prev, -7))}
                    className="p-1.5 border border-slate-300 rounded-md text-slate-700 hover:bg-slate-50 cursor-pointer"
                    aria-label="Previous week"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setCalendarStart(getTodayIso())}
                    className="px-3 py-1.5 text-xs font-medium border border-slate-300 rounded-md text-slate-700 hover:bg-slate-50 cursor-pointer"
                  >
                    Today
                  </button>
                  <button
                    type="button"
                    onClick={() => setCalendarStart((prev) => addDaysIso(prev, 7))}
                    className="p-1.5 border border-slate-300 rounded-md text-slate-700 hover:bg-slate-50 cursor-pointer"
                    aria-label="Next week"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                  <span className="text-xs font-mono text-slate-600 ml-1 tabular-nums">
                    {formatShortDate(calendarDays[0])} –{' '}
                    {formatShortDate(calendarDays[calendarDays.length - 1])}
                  </span>
                </div>

                <div className="flex items-center gap-3 text-xs text-slate-500">
                  <span className="text-amber-700 font-medium">Pending</span>
                  <span aria-hidden="true">·</span>
                  <span className="text-blue-700 font-medium">Confirmed</span>
                  <span aria-hidden="true">·</span>
                  <span className="text-emerald-700 font-medium">Checked In</span>
                </div>
              </div>

              {rooms.length === 0 ? (
                <p className="text-xs text-slate-500 py-8 text-center">
                  Add rooms to view the occupancy calendar.
                </p>
              ) : (
                <div className="overflow-x-auto border border-stone-200/80 bg-white/70 rounded-xl">
                  <table className="w-full border-collapse min-w-[760px]">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200">
                        <th className="py-2.5 px-3 text-left text-xs font-medium text-slate-500 w-36 sticky left-0 bg-slate-50 z-10 border-r border-slate-200">
                          Room
                        </th>
                        {calendarDays.map((iso) => {
                          const { weekday, dayNum } = formatDayHeader(iso);
                          const isToday = iso === getTodayIso();
                          return (
                            <th
                              key={iso}
                              className={`py-2 px-1 text-center text-[11px] font-medium border-r border-slate-100 last:border-r-0 ${
                                isToday ? 'bg-blue-50/70 text-blue-700 font-semibold' : 'text-slate-500'
                              }`}
                            >
                              <div>{weekday}</div>
                              <div className="font-mono tabular-nums">{dayNum}</div>
                            </th>
                          );
                        })}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {rooms.map((room) => {
                        const roomActiveBookings = filteredBookings.filter(
                          (b) => b.room_id === room.id && b.status !== 'cancelled'
                        );
                        return (
                          <tr key={room.id}>
                            <td className="py-2.5 px-3 sticky left-0 bg-white z-10 border-r border-slate-200">
                              <p className="font-mono text-xs font-semibold text-slate-900">
                                Room {room.room_number}
                              </p>
                              <p className="text-[11px] text-slate-500 truncate max-w-[120px]">
                                {room.room_type}
                              </p>
                            </td>
                            {calendarDays.map((iso) => {
                              const nextIso = addDaysIso(iso, 1);
                              const booking = roomActiveBookings.find((b) =>
                                dateRangesOverlap(iso, nextIso, b.check_in, b.check_out)
                              );
                              const isStart = booking?.check_in === iso;
                              const isSelected = booking?.id === selectedCalBookingId;
                              return (
                                <td
                                  key={iso}
                                  className="p-1 border-r border-slate-100 last:border-r-0 align-middle"
                                >
                                  {booking ? (
                                    <button
                                      type="button"
                                      onClick={() => setSelectedCalBookingId(booking.id)}
                                      title={`${booking.guest_name} (${BOOKING_STATUS_LABEL[booking.status]}) · ${booking.check_in} to ${booking.check_out}`}
                                      className={`w-full h-7 px-1 rounded border text-[10px] font-medium truncate transition-all cursor-pointer ${
                                        CALENDAR_BAR_COLOR[booking.status]
                                      } ${isSelected ? 'ring-2 ring-slate-900' : ''}`}
                                    >
                                      {isStart || iso === calendarDays[0]
                                        ? booking.guest_name.split(' ')[0]
                                        : '·'}
                                    </button>
                                  ) : (
                                    <div className="h-7 rounded bg-slate-50/40" />
                                  )}
                                </td>
                              );
                            })}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Selected Booking Detail Strip */}
              {selectedCalendarBooking && (
                <div className="p-4 bg-white/75 border border-stone-200/80 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-2.5 text-sm">
                      <span className="font-semibold text-slate-900">
                        {selectedCalendarBooking.guest_name}
                      </span>
                      <span className="text-slate-300">·</span>
                      <span className="font-mono text-xs text-slate-600">
                        Room {selectedCalendarBooking.room_number}
                      </span>
                      <span className="text-slate-300">·</span>
                      <span className={`text-xs ${BOOKING_STATUS_COLOR[selectedCalendarBooking.status]}`}>
                        {BOOKING_STATUS_LABEL[selectedCalendarBooking.status]}
                      </span>
                    </div>
                    <p className="text-xs text-slate-600 font-mono tabular-nums">
                      {selectedCalendarBooking.check_in} → {selectedCalendarBooking.check_out} ·{' '}
                      {selectedCalendarBooking.guest_contact} ·{' '}
                      {formatCurrency(selectedCalendarBooking.total_price)}
                    </p>
                    {(() => {
                      const pMethod = getEffectivePaymentMethod(
                        selectedCalendarBooking.payment_method
                      );
                      const pStatus = getEffectivePaymentStatus(
                        selectedCalendarBooking.payment_status
                      );
                      if (
                        selectedCalendarBooking.status !== 'cancelled' &&
                        pMethod === 'upi' &&
                        pStatus === 'verification_pending'
                      ) {
                        return (
                          <p className="text-xs font-semibold text-amber-800 pt-0.5">
                            Verify UPI Payment · UTR:{' '}
                            <span className="font-mono">
                              {selectedCalendarBooking.utr_number || 'Not provided'}
                            </span>
                          </p>
                        );
                      }
                      if (pStatus === 'paid') {
                        return (
                          <p className="text-xs font-semibold text-emerald-700 pt-0.5">
                            Paid via {pMethod === 'upi' ? 'UPI' : 'Cash'}
                            {selectedCalendarBooking.utr_number
                              ? ` · UTR ${selectedCalendarBooking.utr_number}`
                              : ''}
                          </p>
                        );
                      }
                      return (
                        <p className="text-xs text-slate-500 pt-0.5">Cash at Counter · Unpaid</p>
                      );
                    })()}
                    {selectedCalendarBooking.notes && (
                      <p className="text-xs text-slate-500 pt-0.5">
                        Note: {selectedCalendarBooking.notes}
                      </p>
                    )}
                  </div>
                  <div className="shrink-0">{renderBookingActions(selectedCalendarBooking)}</div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Room Modal */}
      {roomModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="fixed inset-0 glass-backdrop"
            onClick={() => setRoomModalOpen(false)}
          />
          <div className="relative z-10 w-full max-w-md glass-modal rounded-2xl overflow-hidden">
            <div className="px-6 py-4 border-b border-stone-200/75 flex items-center justify-between">
              <h3 className="font-display text-base font-semibold text-slate-900">
                {editingRoom ? `Edit Room ${editingRoom.room_number}` : 'Add Room'}
              </h3>
              <button
                type="button"
                onClick={() => setRoomModalOpen(false)}
                className="p-1.5 text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={(e) => void handleSaveRoom(e)} className="p-6 space-y-4">
              {roomError && (
                <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
                  {roomError}
                </div>
              )}
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Room #</label>
                  <input
                    type="text"
                    required
                    maxLength={24}
                    value={roomNumber}
                    onChange={(e) => setRoomNumber(e.target.value)}
                    placeholder="201"
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg focus:border-blue-600 focus:outline-none"
                  />
                </div>
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-slate-700 mb-1">Title</label>
                  <input
                    type="text"
                    required
                    maxLength={100}
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Garden King Suite"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:border-blue-600 focus:outline-none"
                  />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Type</label>
                  <input
                    type="text"
                    required
                    maxLength={60}
                    value={roomType}
                    onChange={(e) => setRoomType(e.target.value)}
                    placeholder="Deluxe / Suite"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:border-blue-600 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Rate / nt (₹)
                  </label>
                  <input
                    type="number"
                    required
                    min="0"
                    step="0.01"
                    value={nightlyRate}
                    onChange={(e) => setNightlyRate(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg focus:border-blue-600 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Capacity</label>
                  <input
                    type="number"
                    required
                    min="1"
                    max="20"
                    value={capacity}
                    onChange={(e) => setCapacity(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg focus:border-blue-600 focus:outline-none"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Amenities (comma-separated)
                </label>
                <input
                  type="text"
                  value={amenitiesText}
                  onChange={(e) => setAmenitiesText(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:border-blue-600 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Photo URL (Optional)
                </label>
                <input
                  type="text"
                  maxLength={500}
                  value={imageUrl}
                  onChange={(e) => setImageUrl(e.target.value)}
                  placeholder="https://example.com/suite.jpg"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:border-blue-600 focus:outline-none"
                />
              </div>
              <div className="pt-3 border-t border-slate-200 flex justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setRoomModalOpen(false)}
                  className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingRoom}
                  className="px-4 py-2 text-xs font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 disabled:opacity-60 cursor-pointer"
                >
                  {savingRoom ? 'Saving...' : 'Save Room'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Booking Modal */}
      {bookingModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="fixed inset-0 glass-backdrop"
            onClick={() => setBookingModalOpen(false)}
          />
          <div className="relative z-10 w-full max-w-md glass-modal rounded-2xl overflow-hidden">
            <div className="px-6 py-4 border-b border-stone-200/75 flex items-center justify-between">
              <h3 className="font-display text-base font-semibold text-slate-900">
                New Room Booking
              </h3>
              <button
                type="button"
                onClick={() => setBookingModalOpen(false)}
                className="p-1.5 text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={(e) => void handleCreateBooking(e)} className="p-6 space-y-4">
              {bookingError && (
                <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
                  {bookingError}
                </div>
              )}
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Room</label>
                <select
                  required
                  value={bookingRoomId}
                  onChange={(e) => setBookingRoomId(e.target.value)}
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
                  placeholder="Full name"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:border-blue-600 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Guest Phone or Email
                </label>
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
                      if (checkOut <= val) {
                        setCheckOut(addDaysIso(val, 1));
                      }
                    }}
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg focus:border-blue-600 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Check-Out</label>
                  <input
                    type="date"
                    required
                    min={checkIn ? addDaysIso(checkIn, 1) : undefined}
                    value={checkOut}
                    onChange={(e) => setCheckOut(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg focus:border-blue-600 focus:outline-none"
                  />
                </div>
              </div>
              {modalNights > 0 && modalSelectedRoom && (
                <div className="px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-lg flex items-center justify-between text-xs">
                  <span className="text-slate-600">
                    {modalNights} {modalNights === 1 ? 'night' : 'nights'} ×{' '}
                    {formatCurrency(modalSelectedRoom.nightly_rate)}
                  </span>
                  <span className="font-mono font-semibold text-slate-900 tabular-nums">
                    {formatCurrency(modalTotalEstimate)}
                  </span>
                </div>
              )}
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Notes (Optional)
                </label>
                <textarea
                  rows={2}
                  maxLength={300}
                  value={bookingNotes}
                  onChange={(e) => setBookingNotes(e.target.value)}
                  placeholder="Arrival time or special requests."
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:border-blue-600 focus:outline-none resize-none"
                />
              </div>
              <div className="pt-3 border-t border-slate-200 flex justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setBookingModalOpen(false)}
                  className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingBooking}
                  className="px-4 py-2 text-xs font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 disabled:opacity-60 cursor-pointer"
                >
                  {savingBooking ? 'Confirming...' : 'Confirm Booking'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
