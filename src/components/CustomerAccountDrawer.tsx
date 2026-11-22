import React, { useEffect, useState } from 'react';
import type { User } from 'firebase/auth';
import {
  Award,
  CheckCircle2,
  ClipboardList,
  LogOut,
  Pencil,
  Phone,
  ShieldCheck,
  UserCheck,
  X,
} from 'lucide-react';
import { registerShopCustomer, updateShopCustomerProfile } from '../lib/firestoreService';
import {
  formatCurrency,
  formatIndianMobile,
  validateCustomerName,
  validateIndianMobile,
} from '../lib/validation';
import { Order, ShopCustomer, ShopSlugRecord } from '../types';

interface CustomerAccountDrawerProps {
  open: boolean;
  onClose: () => void;
  shop: ShopSlugRecord;
  user: User | null;
  customer: ShopCustomer | null;
  customerLoading: boolean;
  customerOrders: Order[];
  authError: string | null;
  onSignInWithGoogle: () => Promise<void>;
  onSignOut: () => Promise<void>;
  onSelectOrderToTrack: (order: Order) => void;
  accentColor: string;
}

function getOrderStatusStyle(status: Order['status']): string {
  switch (status) {
    case 'paid':
      return 'text-emerald-700 bg-emerald-50 border-emerald-200';
    case 'cancelled':
      return 'text-red-700 bg-red-50 border-red-200';
    case 'served':
      return 'text-amber-800 bg-amber-50 border-amber-200';
    default:
      return 'text-blue-800 bg-blue-50 border-blue-200';
  }
}

export const CustomerAccountDrawer: React.FC<CustomerAccountDrawerProps> = ({
  open,
  onClose,
  shop,
  user,
  customer,
  customerLoading,
  customerOrders,
  authError,
  onSignInWithGoogle,
  onSignOut,
  onSelectOrderToTrack,
  accentColor,
}) => {
  const [signingIn, setSigningIn] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  const [fullName, setFullName] = useState('');
  const [mobileNumber, setMobileNumber] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);
  const [mobileError, setMobileError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [editingProfile, setEditingProfile] = useState(false);

  useEffect(() => {
    if (!open) return;
    setFormError(null);
    setFormSuccess(null);
    setNameError(null);
    setMobileError(null);
    if (customer) {
      setFullName(customer.full_name);
      setMobileNumber(formatIndianMobile(customer.mobile_number));
      setEditingProfile(false);
    } else if (user) {
      const candidate = user.displayName || '';
      setFullName(validateCustomerName(candidate).valid ? candidate.trim() : '');
      setMobileNumber('');
      setEditingProfile(false);
    }
  }, [open, customer, user]);

  if (!open) return null;

  const handleGoogleSignIn = async () => {
    setFormError(null);
    setSigningIn(true);
    try {
      await onSignInWithGoogle();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Unable to sign in with Google.');
    } finally {
      setSigningIn(false);
    }
  };

  const handleSignOut = async () => {
    setFormError(null);
    setSigningOut(true);
    try {
      await onSignOut();
      setEditingProfile(false);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Unable to sign out.');
    } finally {
      setSigningOut(false);
    }
  };

  const handleRegisterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !user.email) {
      setFormError('Please sign in with a verified Google account first.');
      return;
    }

    const nameCheck = validateCustomerName(fullName);
    const mobileCheck = validateIndianMobile(mobileNumber);
    setNameError(nameCheck.valid ? null : nameCheck.error || 'Enter a valid full name.');
    setMobileError(mobileCheck.valid ? null : mobileCheck.error || 'Enter a valid mobile number.');
    setFormError(null);
    setFormSuccess(null);

    if (!nameCheck.valid || !mobileCheck.valid) return;

    setSaving(true);
    try {
      await registerShopCustomer(shop.shop_id, {
        uid: user.uid,
        email: user.email,
        full_name: nameCheck.value,
        mobile_number: mobileCheck.value,
      });
      setFormSuccess(`You are now registered at ${shop.name}.`);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Unable to complete registration.');
    } finally {
      setSaving(false);
    }
  };

  const handleUpdateProfileSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !customer) return;

    const nameCheck = validateCustomerName(fullName);
    const mobileCheck = validateIndianMobile(mobileNumber);
    setNameError(nameCheck.valid ? null : nameCheck.error || 'Enter a valid full name.');
    setMobileError(mobileCheck.valid ? null : mobileCheck.error || 'Enter a valid mobile number.');
    setFormError(null);
    setFormSuccess(null);

    if (!nameCheck.valid || !mobileCheck.valid) return;

    setSaving(true);
    try {
      const updated = await updateShopCustomerProfile(shop.shop_id, user.uid, {
        full_name: nameCheck.value,
        mobile_number: mobileCheck.value,
      });
      setFullName(updated.full_name);
      setMobileNumber(formatIndianMobile(updated.mobile_number));
      setEditingProfile(false);
      setFormSuccess('Your member details have been updated.');
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Unable to update details.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div
        className="fixed inset-0 bg-slate-950/40 backdrop-blur-[1px]"
        onClick={onClose}
      />
      <div className="relative z-10 w-full max-w-md bg-white h-full shadow-2xl border-l border-slate-200 flex flex-col">
        {/* Drawer Header */}
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="font-display text-base font-semibold text-slate-900 truncate">
              {customer ? `${shop.name} Member` : `Member Access · ${shop.name}`}
            </h2>
            <p className="text-xs text-slate-500 truncate">
              {customer
                ? 'Saved details, order history & rewards balance'
                : 'Register once for fast repeat ordering & future rewards'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-700 cursor-pointer shrink-0"
            aria-label="Close member panel"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Drawer Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {(authError || formError) && (
            <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
              {formError || authError}
            </div>
          )}

          {formSuccess && (
            <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-800 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>{formSuccess}</span>
            </div>
          )}

          {!user ? (
            /* STATE 1: Not Signed In */
            <div className="space-y-5">
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-3">
                <div className="flex items-center gap-2.5">
                  <div
                    className="w-9 h-9 rounded-lg flex items-center justify-center text-white shrink-0"
                    style={{ backgroundColor: accentColor }}
                  >
                    <Award className="w-4 h-4" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-slate-900">
                      Join {shop.name} Members
                    </p>
                    <p className="text-xs text-slate-500">
                      Returning customers sign in directly to skip re-typing details.
                    </p>
                  </div>
                </div>

                <ul className="space-y-2 pt-2 border-t border-slate-200 text-xs text-slate-700">
                  <li className="flex items-start gap-2">
                    <UserCheck className="w-3.5 h-3.5 text-emerald-600 mt-0.5 shrink-0" />
                    <span>Auto-fill your verified name and Indian mobile number on every visit.</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <Award className="w-3.5 h-3.5 text-amber-600 mt-0.5 shrink-0" />
                    <span>
                      Earn <strong className="font-mono text-slate-900">1 reward point</strong> per{' '}
                      <strong className="font-mono text-slate-900">₹10</strong> paid on settled bills.
                    </span>
                  </li>
                  <li className="flex items-start gap-2">
                    <ClipboardList className="w-3.5 h-3.5 text-blue-600 mt-0.5 shrink-0" />
                    <span>Access past bills and recover active orders even if you switch devices.</span>
                  </li>
                </ul>
              </div>

              <button
                type="button"
                disabled={signingIn}
                onClick={() => void handleGoogleSignIn()}
                className="w-full py-2.5 px-4 text-xs font-semibold text-white rounded-lg hover:opacity-95 disabled:opacity-60 flex items-center justify-center gap-2 cursor-pointer"
                style={{ backgroundColor: accentColor }}
              >
                <ShieldCheck className="w-4 h-4 shrink-0" />
                <span>{signingIn ? 'Signing in...' : 'Continue with Google'}</span>
              </button>

              <p className="text-[11px] text-slate-500 text-center leading-relaxed">
                Your membership is private to {shop.name}. Only you and {shop.name}’s owner can
                view your saved contact details and reward points.
              </p>
            </div>
          ) : customerLoading ? (
            <div className="py-12 text-center text-xs text-slate-500">
              Checking your {shop.name} membership...
            </div>
          ) : !customer ? (
            /* STATE 2: Signed In with Google, Needs 1-Time Registration for This Restaurant */
            <form onSubmit={(e) => void handleRegisterSubmit(e)} className="space-y-4">
              <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[11px] font-medium text-slate-500">Signed in as</p>
                  <p className="text-xs font-semibold text-slate-900 truncate">{user.email}</p>
                </div>
                <button
                  type="button"
                  disabled={signingOut}
                  onClick={() => void handleSignOut()}
                  className="text-xs font-medium text-slate-600 hover:text-slate-900 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  Switch Account
                </button>
              </div>

              <div>
                <p className="text-sm font-semibold text-slate-900">
                  Complete your {shop.name} registration
                </p>
                <p className="text-xs text-slate-500 mt-0.5">
                  Enter your real full name and 10-digit Indian mobile number once. Next time you
                  visit, your details will auto-fill automatically.
                </p>
              </div>

              <div className="space-y-3.5">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Full Name <span className="text-red-600">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={80}
                    value={fullName}
                    onChange={(e) => {
                      setFullName(e.target.value);
                      if (nameError) setNameError(null);
                    }}
                    placeholder="e.g. Aarav Sharma"
                    className={`w-full px-3 py-2 text-sm border rounded-lg focus:outline-none ${
                      nameError
                        ? 'border-red-400 focus:border-red-500 bg-red-50/30'
                        : 'border-slate-300 focus:border-blue-600'
                    }`}
                  />
                  {nameError && <p className="mt-1 text-[11px] text-red-600">{nameError}</p>}
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Mobile Number (India +91) <span className="text-red-600">*</span>
                  </label>
                  <input
                    type="tel"
                    required
                    maxLength={20}
                    value={mobileNumber}
                    onChange={(e) => {
                      setMobileNumber(e.target.value);
                      if (mobileError) setMobileError(null);
                    }}
                    placeholder="+91 98201 44512"
                    className={`w-full px-3 py-2 text-sm font-mono border rounded-lg focus:outline-none ${
                      mobileError
                        ? 'border-red-400 focus:border-red-500 bg-red-50/30'
                        : 'border-slate-300 focus:border-blue-600'
                    }`}
                  />
                  {mobileError ? (
                    <p className="mt-1 text-[11px] text-red-600">{mobileError}</p>
                  ) : (
                    <p className="mt-1 text-[11px] text-slate-500">
                      10-digit Indian mobile number starting with 6, 7, 8, or 9.
                    </p>
                  )}
                </div>
              </div>

              <button
                type="submit"
                disabled={saving}
                className="w-full py-2.5 px-4 text-xs font-semibold text-white rounded-lg hover:opacity-95 disabled:opacity-60 cursor-pointer"
                style={{ backgroundColor: accentColor }}
              >
                {saving ? 'Registering...' : `Register for ${shop.name}`}
              </button>
            </form>
          ) : (
            /* STATE 3: Registered Returning Member */
            <div className="space-y-5">
              {/* Rewards & Loyalty KPI Card */}
              <div className="rounded-xl border border-slate-200 bg-slate-900 text-white p-5 space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[11px] uppercase tracking-wider text-slate-400 font-medium">
                      {shop.name} Rewards
                    </p>
                    <p className="mt-1 font-display text-2xl font-bold font-mono tabular-nums">
                      {(customer.reward_points || 0).toLocaleString('en-IN')}{' '}
                      <span className="text-xs font-sans font-medium text-slate-300">pts</span>
                    </p>
                  </div>
                  <div className="w-9 h-9 rounded-lg bg-white/10 flex items-center justify-center shrink-0">
                    <Award className="w-4 h-4 text-amber-300" />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 pt-3 border-t border-white/10 text-xs">
                  <div>
                    <p className="text-slate-400 text-[11px]">Settled Orders</p>
                    <p className="font-mono font-semibold text-white tabular-nums mt-0.5">
                      {customer.total_orders || 0}
                    </p>
                  </div>
                  <div>
                    <p className="text-slate-400 text-[11px]">Total Spent</p>
                    <p className="font-mono font-semibold text-white tabular-nums mt-0.5">
                      {formatCurrency(customer.total_spent || 0)}
                    </p>
                  </div>
                </div>

                <p className="text-[11px] text-slate-300">
                  Rewards program ready · Earn 1 pt per ₹10 paid on settled bills.
                </p>
              </div>

              {/* Member Profile / Edit Form */}
              <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold text-slate-900">Verified Member Details</p>
                  {!editingProfile && (
                    <button
                      type="button"
                      onClick={() => {
                        setEditingProfile(true);
                        setFormError(null);
                        setFormSuccess(null);
                      }}
                      className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 hover:text-blue-900 cursor-pointer"
                    >
                      <Pencil className="w-3 h-3" />
                      <span>Edit</span>
                    </button>
                  )}
                </div>

                {editingProfile ? (
                  <form onSubmit={(e) => void handleUpdateProfileSubmit(e)} className="space-y-3">
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        Full Name
                      </label>
                      <input
                        type="text"
                        required
                        maxLength={80}
                        value={fullName}
                        onChange={(e) => {
                          setFullName(e.target.value);
                          if (nameError) setNameError(null);
                        }}
                        className={`w-full px-3 py-2 text-sm border rounded-lg focus:outline-none ${
                          nameError
                            ? 'border-red-400 focus:border-red-500'
                            : 'border-slate-300 focus:border-blue-600'
                        }`}
                      />
                      {nameError && <p className="mt-1 text-[11px] text-red-600">{nameError}</p>}
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        Mobile Number
                      </label>
                      <input
                        type="tel"
                        required
                        maxLength={20}
                        value={mobileNumber}
                        onChange={(e) => {
                          setMobileNumber(e.target.value);
                          if (mobileError) setMobileError(null);
                        }}
                        className={`w-full px-3 py-2 text-sm font-mono border rounded-lg focus:outline-none ${
                          mobileError
                            ? 'border-red-400 focus:border-red-500'
                            : 'border-slate-300 focus:border-blue-600'
                        }`}
                      />
                      {mobileError && (
                        <p className="mt-1 text-[11px] text-red-600">{mobileError}</p>
                      )}
                    </div>
                    <div className="flex items-center justify-end gap-2 pt-1">
                      <button
                        type="button"
                        disabled={saving}
                        onClick={() => {
                          setEditingProfile(false);
                          setFullName(customer.full_name);
                          setMobileNumber(formatIndianMobile(customer.mobile_number));
                          setNameError(null);
                          setMobileError(null);
                        }}
                        className="px-3 py-1.5 text-xs font-medium text-slate-600 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 cursor-pointer"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        disabled={saving}
                        className="px-3.5 py-1.5 text-xs font-semibold text-white rounded-lg hover:opacity-95 disabled:opacity-60 cursor-pointer"
                        style={{ backgroundColor: accentColor }}
                      >
                        {saving ? 'Saving...' : 'Save Changes'}
                      </button>
                    </div>
                  </form>
                ) : (
                  <div className="space-y-2 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-slate-500">Full Name</span>
                      <span className="font-semibold text-slate-900">{customer.full_name}</span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-slate-500 flex items-center gap-1">
                        <Phone className="w-3 h-3" /> Mobile
                      </span>
                      <span className="font-mono font-medium text-slate-900 tabular-nums">
                        {formatIndianMobile(customer.mobile_number)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-slate-500">Email</span>
                      <span className="text-slate-700 truncate">{customer.email}</span>
                    </div>
                  </div>
                )}
              </div>

              {/* Member Order History at this Restaurant */}
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-semibold text-slate-900">
                    Your Orders at {shop.name}
                  </h3>
                  <span className="text-[11px] font-mono text-slate-500 tabular-nums">
                    {customerOrders.length} total
                  </span>
                </div>

                {customerOrders.length === 0 ? (
                  <div className="p-5 rounded-xl border border-slate-200 bg-slate-50 text-center text-xs text-slate-500">
                    No orders placed under your member account yet. Add items from the menu to
                    start earning reward points!
                  </div>
                ) : (
                  <ul className="space-y-2.5">
                    {customerOrders.slice(0, 15).map((ord) => {
                      const isOpen = ord.status !== 'paid' && ord.status !== 'cancelled';
                      const itemCount = ord.items.reduce((sum, i) => sum + i.quantity, 0);
                      return (
                        <li
                          key={ord.id}
                          className="p-3.5 rounded-xl border border-slate-200 bg-white space-y-2"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="font-mono text-xs font-semibold text-slate-900">
                                {ord.order_number}
                              </span>
                              <span className="text-xs text-slate-500 truncate">
                                · {ord.table_or_room}
                              </span>
                            </div>
                            <span
                              className={`px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide rounded border ${getOrderStatusStyle(
                                ord.status
                              )}`}
                            >
                              {ord.status}
                            </span>
                          </div>
                          <p className="text-xs text-slate-600 line-clamp-2">
                            {ord.items.map((i) => `${i.quantity}× ${i.name}`).join(', ')}
                          </p>
                          <div className="flex items-center justify-between gap-2 pt-1.5 border-t border-slate-100 text-xs">
                            <span className="text-slate-500 font-mono tabular-nums">
                              {itemCount} {itemCount === 1 ? 'item' : 'items'} ·{' '}
                              <strong className="text-slate-900">
                                {formatCurrency(ord.total_amount)}
                              </strong>
                            </span>
                            <button
                              type="button"
                              onClick={() => {
                                onSelectOrderToTrack(ord);
                                onClose();
                              }}
                              className="text-xs font-semibold hover:underline cursor-pointer"
                              style={{ color: accentColor }}
                            >
                              {isOpen ? 'Track / Pay Bill' : 'View Receipt'}
                            </button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>

              {/* Sign Out */}
              <div className="pt-2 border-t border-slate-200">
                <button
                  type="button"
                  disabled={signingOut}
                  onClick={() => void handleSignOut()}
                  className="w-full py-2 px-4 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 flex items-center justify-center gap-2 cursor-pointer"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span>{signingOut ? 'Signing out...' : 'Sign Out'}</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
