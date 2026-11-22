export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const LOCAL_ASSET_PATTERN = /^\/src\/assets\/images\/[a-zA-Z0-9_-]+\.(jpg|jpeg|png|webp)$/;

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64);
}

export function isValidSlug(slug: string): boolean {
  return slug.length >= 2 && slug.length <= 64 && SLUG_PATTERN.test(slug);
}

export function isValidHexColor(color: string): boolean {
  return HEX_COLOR_PATTERN.test(color);
}

export function isValidEmail(email: string): boolean {
  const normalized = email.trim().toLowerCase();
  return normalized.length >= 3 && normalized.length <= 200 && EMAIL_PATTERN.test(normalized);
}

export function isSafeMediaUrl(url: string): boolean {
  const trimmed = url.trim();
  if (!trimmed) return true;
  if (trimmed.length > 500) return false;
  if (LOCAL_ASSET_PATTERN.test(trimmed)) return true;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

export function clampString(val: string, maxLen: number): string {
  return val.trim().slice(0, maxLen);
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(amount) ? amount : 0);
}

export function formatTimeAgo(date: Date | null): string {
  if (!date) return 'Just now';
  const diffSec = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

export function getShopTypeLabel(type: string): string {
  switch (type) {
    case 'cafe':
      return 'Cafe';
    case 'restaurant':
      return 'Restaurant';
    case 'hotel':
      return 'Hotel';
    case 'both':
      return 'Hotel & Dining';
    default:
      return type;
  }
}
