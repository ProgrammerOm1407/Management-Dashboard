import { BookingStatus } from '../types';

export function toLocalIsoDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function getTodayIso(): string {
  return toLocalIsoDate(new Date());
}

export function addDaysIso(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(y, (m || 1) - 1, (d || 1) + days);
  return toLocalIsoDate(dt);
}

export function diffNights(checkIn: string, checkOut: string): number {
  if (!checkIn || !checkOut) return 0;
  const [y1, m1, d1] = checkIn.split('-').map(Number);
  const [y2, m2, d2] = checkOut.split('-').map(Number);
  const t1 = Date.UTC(y1, (m1 || 1) - 1, d1 || 1);
  const t2 = Date.UTC(y2, (m2 || 1) - 1, d2 || 1);
  return Math.round((t2 - t1) / 86400000);
}

/**
 * Standard hotel date-range overlap check:
 * [startA, endA) overlaps [startB, endB) iff startA < endB && endA > startB.
 * Same-day checkout & check-in is allowed (non-overlapping).
 */
export function dateRangesOverlap(
  startA: string,
  endA: string,
  startB: string,
  endB: string
): boolean {
  if (!startA || !endA || !startB || !endB) return false;
  return startA < endB && endA > startB;
}

export function isActiveBookingStatus(status: BookingStatus): boolean {
  return status === 'pending' || status === 'confirmed' || status === 'checked_in';
}

export function formatShortDate(isoDate: string): string {
  if (!isoDate) return '';
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(y, (m || 1) - 1, d || 1);
  return dt.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

export function formatDayHeader(isoDate: string): { weekday: string; dayNum: string; month: string } {
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(y, (m || 1) - 1, d || 1);
  return {
    weekday: dt.toLocaleDateString('en-IN', { weekday: 'short' }),
    dayNum: String(dt.getDate()),
    month: dt.toLocaleDateString('en-IN', { month: 'short' }),
  };
}
