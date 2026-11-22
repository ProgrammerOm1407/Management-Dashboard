export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const LOCAL_ASSET_PATTERN = /^\/src\/assets\/images\/[a-zA-Z0-9_-]+\.(jpg|jpeg|png|webp)$/;
export const CUSTOMER_NAME_PATTERN = /^[A-Za-z][A-Za-z .'-]{1,79}$/;
export const INDIAN_MOBILE_E164_PATTERN = /^\+91[6-9][0-9]{9}$/;

const DEMO_NAME_TOKENS = new Set([
  'test',
  'testing',
  'tester',
  'demo',
  'sample',
  'fake',
  'dummy',
  'asdf',
  'asdfg',
  'asdfgh',
  'qwerty',
  'zxcv',
  'zxcvb',
  'abc',
  'abcd',
  'abcde',
  'xyz',
  'guest',
  'user',
  'admin',
  'owner',
  'customer',
  'client',
  'anonymous',
  'anon',
  'temp',
  'tmp',
  'none',
  'null',
  'undefined',
  'na',
  'n/a',
  'walkin',
  'walk-in',
  'foo',
  'bar',
  'baz',
  'unknown',
  'nobody',
  'someone',
  'name',
  'asdfghjkl',
  'qwertyuiop',
]);

const DEMO_FULL_NAMES = new Set([
  'john doe',
  'jane doe',
  'test user',
  'demo user',
  'guest user',
  'your name',
  'my name',
  'full name',
  'first last',
  'walk in',
  'walk in guest',
]);

const DEMO_MOBILE_CORES = new Set([
  '9876543210',
  '9123456789',
  '6789012345',
  '7890123456',
  '8901234567',
  '9876500000',
  '9999900000',
  '9000000000',
  '8000000000',
  '7000000000',
  '6000000000',
  '9988776655',
  '9876598765',
  '9111111111',
  '8111111111',
  '7111111111',
  '6111111111',
  '9876543211',
  '9999999990',
]);

const DEMO_TABLE_TOKENS = new Set([
  'test',
  'testing',
  'demo',
  'sample',
  'fake',
  'dummy',
  'asdf',
  'qwerty',
  'abc',
  'xyz',
  'none',
  'null',
  'na',
  'n/a',
  'unknown',
]);

const ALLOWED_NAMED_LOCATIONS = new Set([
  'counter',
  'takeaway',
  'parcel',
  'pickup',
  'bar',
  'patio',
  'balcony',
  'garden',
  'lounge',
  'rooftop',
  'lobby',
]);

export interface ValidationResult {
  valid: boolean;
  value: string;
  error?: string;
}

export function validateCustomerName(raw: string): ValidationResult {
  const cleaned = raw.trim().replace(/\s+/g, ' ');
  if (!cleaned) {
    return { valid: false, value: '', error: 'Please enter your full name.' };
  }
  if (cleaned.length < 2 || cleaned.length > 80) {
    return {
      valid: false,
      value: cleaned,
      error: 'Name must be between 2 and 80 characters.',
    };
  }
  if (!CUSTOMER_NAME_PATTERN.test(cleaned)) {
    return {
      valid: false,
      value: cleaned,
      error: 'Use only real letters and spaces (no numbers or symbols).',
    };
  }
  const lettersOnly = cleaned.replace(/[^A-Za-z]/g, '');
  if (lettersOnly.length < 2) {
    return {
      valid: false,
      value: cleaned,
      error: 'Please enter a valid real name.',
    };
  }
  if (/(.)\1{3,}/i.test(lettersOnly)) {
    return {
      valid: false,
      value: cleaned,
      error: 'Please enter your real name (repeated placeholder letters are not allowed).',
    };
  }
  const lower = cleaned.toLowerCase();
  if (DEMO_FULL_NAMES.has(lower) || DEMO_NAME_TOKENS.has(lower)) {
    return {
      valid: false,
      value: cleaned,
      error: 'Demo or placeholder names are not allowed. Please enter your real name.',
    };
  }
  const words = lower.split(/\s+/);
  if (words.some((w) => DEMO_NAME_TOKENS.has(w))) {
    return {
      valid: false,
      value: cleaned,
      error: 'Demo or placeholder words are not allowed. Please enter your real name.',
    };
  }
  return { valid: true, value: cleaned };
}

export function validateIndianMobile(raw: string): ValidationResult {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { valid: false, value: '', error: 'Mobile number is required.' };
  }
  const digitsOnly = trimmed.replace(/[^\d]/g, '');
  let core = digitsOnly;
  if (core.length === 12 && core.startsWith('91')) {
    core = core.slice(2);
  } else if (core.length === 11 && core.startsWith('0')) {
    core = core.slice(1);
  }

  if (!/^[6-9]\d{9}$/.test(core)) {
    return {
      valid: false,
      value: trimmed,
      error: 'Enter a valid 10-digit Indian mobile number starting with 6, 7, 8, or 9.',
    };
  }

  if (
    /^(\d)\1{9}$/.test(core) ||
    /(\d)\1{5,}/.test(core) ||
    /^(\d{2})\1{4}$/.test(core) ||
    DEMO_MOBILE_CORES.has(core)
  ) {
    return {
      valid: false,
      value: trimmed,
      error: 'Please enter your real mobile number (demo or repeating numbers are not accepted).',
    };
  }

  return { valid: true, value: `+91${core}` };
}

export function formatIndianMobile(raw: string | null | undefined): string {
  if (!raw) return '';
  const digits = raw.replace(/[^\d]/g, '');
  const core = digits.length === 12 && digits.startsWith('91') ? digits.slice(2) : digits;
  if (core.length === 10) {
    return `+91 ${core.slice(0, 5)} ${core.slice(5)}`;
  }
  return raw;
}

export function validateTableOrRoom(raw: string): ValidationResult {
  const cleaned = raw.trim().replace(/\s+/g, ' ');
  if (!cleaned) {
    return { valid: false, value: '', error: 'Please enter your table or room number.' };
  }
  if (cleaned.length > 60) {
    return {
      valid: false,
      value: cleaned.slice(0, 60),
      error: 'Table or room label must be 60 characters or fewer.',
    };
  }
  const lower = cleaned.toLowerCase();
  if (DEMO_TABLE_TOKENS.has(lower) || lower.split(/\s+/).some((w) => DEMO_TABLE_TOKENS.has(w))) {
    return {
      valid: false,
      value: cleaned,
      error: 'Please enter an actual table or room number (e.g. Table 4 or Room 201).',
    };
  }
  const normalized = /^\d+$/.test(cleaned) ? `Table ${cleaned}` : cleaned;
  const hasDigit = /\d/.test(normalized);
  const isNamedLocation = ALLOWED_NAMED_LOCATIONS.has(lower);
  if (!hasDigit && !isNamedLocation) {
    return {
      valid: false,
      value: cleaned,
      error: 'Include a table or room number (e.g. Table 4, T4, Room 201, or Counter).',
    };
  }
  return { valid: true, value: normalized };
}

export function calculateRewardPoints(paidAmount: number): number {
  const safe = Number(paidAmount);
  if (!Number.isFinite(safe) || safe <= 0) return 0;
  return Math.floor(safe / 10);
}

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
