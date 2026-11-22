import { PaymentMethod, PaymentStatus, Shop, ShopSlugRecord } from '../types';

export const UPI_ID_PATTERN = /^[a-zA-Z0-9._-]+@[a-zA-Z0-9]+$/;

export function isValidUpiId(val: string): boolean {
  const trimmed = val.trim();
  return trimmed.length >= 3 && trimmed.length <= 128 && UPI_ID_PATTERN.test(trimmed);
}

export function isShopUpiEnabled(shop: Pick<Shop | ShopSlugRecord, 'accept_upi' | 'upi_id'>): boolean {
  return Boolean(shop.accept_upi) && typeof shop.upi_id === 'string' && isValidUpiId(shop.upi_id);
}

export function isShopCashEnabled(shop: Pick<Shop | ShopSlugRecord, 'accept_cash'>): boolean {
  return shop.accept_cash !== false;
}

export function buildUpiPaymentUri(params: {
  upiId: string;
  payeeName: string;
  amount: number;
  orderRef: string;
}): string {
  const pa = params.upiId.trim();
  const pn = encodeURIComponent((params.payeeName || 'Merchant').trim().slice(0, 100));
  const am = Math.max(0, Number(params.amount) || 0).toFixed(2);
  const cleanRef = params.orderRef.trim().replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40) || 'ORDER';
  const tn = encodeURIComponent(`Order-${cleanRef}`);
  return `upi://pay?pa=${pa}&pn=${pn}&am=${am}&cu=INR&tn=${tn}`;
}

export function generateDraftReference(prefix: 'ORD' | 'BK' = 'ORD'): string {
  const num = Math.floor(1000 + Math.random() * 9000);
  return `${prefix}-${num}`;
}

export function getEffectivePaymentMethod(method?: PaymentMethod): PaymentMethod {
  return method === 'upi' ? 'upi' : 'cash';
}

export function getEffectivePaymentStatus(
  paymentStatus?: PaymentStatus,
  fallbackOrderStatus?: string
): PaymentStatus {
  if (paymentStatus === 'paid' || paymentStatus === 'verification_pending' || paymentStatus === 'unpaid') {
    return paymentStatus;
  }
  if (fallbackOrderStatus === 'paid') {
    return 'paid';
  }
  return 'unpaid';
}
