import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, LogOut, ShieldCheck } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { DEFAULT_HERO_IMAGE } from '../types';
import { SafeImage } from '../components/SafeImage';

export const LoginPage: React.FC = () => {
  const {
    user,
    profile,
    loading,
    unprovisioned,
    authError,
    signInWithGoogle,
    signOutUser,
    refreshProfile,
  } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (loading || !profile) return;
    if (profile.role === 'super_admin') {
      navigate('/super-admin', { replace: true });
    } else if (profile.role === 'owner') {
      navigate('/dashboard', { replace: true });
    } else if (profile.role === 'server') {
      navigate('/server', { replace: true });
    }
  }, [profile, loading, navigate]);

  return (
    <div className="min-h-screen grid lg:grid-cols-12 items-stretch">
      {/* Left Column: Frosted Architectural Authentication Panel */}
      <div className="lg:col-span-5 bg-white/80 backdrop-blur-xl border-r border-stone-200/70 flex flex-col justify-between p-8 sm:p-12 lg:p-16">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-[#111315] text-white font-display font-bold text-base flex items-center justify-center shadow-xs">
            H
          </div>
          <span className="font-display font-bold text-lg tracking-tight text-stone-900">
            HostGrid
          </span>
        </div>

        <div className="my-12 max-w-md w-full">
          <p className="text-xs font-medium text-stone-500">
            Multi-tenant hospitality operations
          </p>
          <h1 className="mt-2.5 font-display text-3xl sm:text-[38px] font-bold tracking-tight text-stone-950 leading-[1.12]">
            Sign in to your venue workspace
          </h1>
          <p className="mt-4 text-sm sm:text-[15px] text-stone-600 leading-relaxed">
            Access your Super Admin console, Shop Owner dashboard, or real-time Kitchen &amp;
            Server board. You will be routed automatically by role.
          </p>

          {authError && (
            <div className="mt-6 p-4 rounded-xl border border-red-200 bg-red-50 text-sm text-red-700">
              {authError}
            </div>
          )}

          {unprovisioned && user ? (
            <div className="mt-8 p-5 rounded-xl border border-amber-200 bg-amber-50/70 space-y-4">
              <div>
                <h2 className="text-sm font-semibold text-stone-900">
                  No workspace invitation found
                </h2>
                <p className="mt-1.5 text-sm text-stone-600 leading-relaxed">
                  Signed in as <span className="font-mono text-stone-900">{user.email}</span>,
                  which is not yet assigned to a shop. Ask your Platform Super Admin or Shop Owner
                  to invite this email address, then check again.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => void refreshProfile()}
                  className="px-4 py-2.5 text-sm font-semibold text-white bg-[#111315] rounded-lg hover:bg-stone-800 transition-colors whitespace-nowrap cursor-pointer"
                >
                  Check Invitation Again
                </button>
                <button
                  type="button"
                  onClick={() => void signOutUser()}
                  className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-stone-700 bg-white border border-stone-300 rounded-lg hover:bg-stone-50 transition-colors whitespace-nowrap cursor-pointer"
                >
                  <LogOut className="w-4 h-4" />
                  Switch Account
                </button>
              </div>
            </div>
          ) : (
            <div className="mt-8 space-y-6">
              <button
                type="button"
                disabled={loading}
                onClick={() => void signInWithGoogle()}
                className="group w-full flex items-center justify-center gap-3 px-5 py-3.5 text-sm font-semibold text-white bg-[#111315] hover:bg-stone-800 disabled:opacity-60 rounded-xl shadow-[0_6px_18px_-6px_rgba(17,19,21,0.45)] hover:-translate-y-0.5 transition-all duration-150 cursor-pointer"
              >
                <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    fill="#ffffff"
                    d="M21.35 11.1h-9.18v2.98h5.27c-.23 1.24-.92 2.29-1.96 3v2.49h3.17c1.86-1.71 2.93-4.23 2.93-7.21 0-.43-.04-.85-.23-1.26z"
                  />
                  <path
                    fill="#e7e5e4"
                    d="M12.17 22c2.65 0 4.88-.88 6.51-2.38l-3.17-2.49c-.88.59-2 .94-3.34.94-2.57 0-4.74-1.73-5.52-4.06H3.38v2.57A9.83 9.83 0 0 0 12.17 22z"
                  />
                  <path
                    fill="#d6d3d1"
                    d="M6.65 14.01a5.91 5.91 0 0 1 0-3.77V7.67H3.38a9.84 9.84 0 0 0 0 8.91l3.27-2.57z"
                  />
                  <path
                    fill="#fafaf9"
                    d="M12.17 6.18c1.44 0 2.74.5 3.76 1.47l2.82-2.82C17.04 3.24 14.82 2.25 12.17 2.25a9.83 9.83 0 0 0-8.79 5.42l3.27 2.57c.78-2.33 2.95-4.06 5.52-4.06z"
                  />
                </svg>
                <span>{loading ? 'Verifying session...' : 'Continue with Google'}</span>
                <ArrowRight className="w-4 h-4 shrink-0 transition-transform duration-150 group-hover:translate-x-0.5" />
              </button>

              <div className="pt-6 border-t border-stone-200 grid grid-cols-3 gap-4 text-xs text-stone-500">
                <div>
                  <p className="font-semibold text-stone-900">Super Admin</p>
                  <p className="mt-1 font-mono text-[11px] text-stone-500">/super-admin</p>
                </div>
                <div>
                  <p className="font-semibold text-stone-900">Shop Owner</p>
                  <p className="mt-1 font-mono text-[11px] text-stone-500">/dashboard</p>
                </div>
                <div>
                  <p className="font-semibold text-stone-900">Kitchen &amp; Floor</p>
                  <p className="mt-1 font-mono text-[11px] text-stone-500">/server</p>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 text-xs text-stone-500">
          <ShieldCheck className="w-4 h-4 text-stone-400 shrink-0" />
          <span>Tenant isolation enforced per shop ID and verified Google role</span>
        </div>
      </div>

      {/* Right Column: Editorial Hospitality Visual Anchor */}
      <div className="hidden lg:block lg:col-span-7 relative overflow-hidden bg-[#111315]">
        <SafeImage
          src={DEFAULT_HERO_IMAGE}
          alt="Modern specialty cafe and hospitality venue interior"
          className="w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-[#0D0F11]/85 via-[#0D0F11]/30 to-[#0D0F11]/10" />

        <div className="absolute inset-x-0 bottom-0 p-8 xl:p-12">
          <div className="max-w-2xl rounded-2xl bg-[#111315]/68 backdrop-blur-xl border border-white/15 shadow-[0_24px_48px_-16px_rgba(0,0,0,0.45),inset_0_1px_0_rgba(255,255,255,0.12)] p-8 xl:p-10 text-white">
            <p className="text-xs font-medium text-stone-300 tracking-wide">
              Cafes · Restaurants · Boutique Hotels
            </p>
            <h2 className="mt-3 font-display text-3xl xl:text-[34px] font-bold tracking-tight leading-[1.2] text-white">
              One unified operating system for every storefront, kitchen queue, and guest stay.
            </h2>
            <p className="mt-4 text-sm text-stone-200/90 leading-relaxed max-w-xl">
              Run QR table ordering with aggregated unpaid bills, real-time kitchen Kanban boards,
              owner-verified UPI &amp; Cash settlements, and repeat guest rewards from a single
              tenant-isolated workspace.
            </p>

            <div className="mt-7 pt-6 border-t border-white/15 grid grid-cols-3 gap-6 text-xs">
              <div>
                <p className="font-semibold text-white">Live Kitchen KDS</p>
                <p className="mt-1 text-stone-300">FIFO queue &amp; batch prep</p>
              </div>
              <div>
                <p className="font-semibold text-white">Pay-at-Exit Bills</p>
                <p className="mt-1 text-stone-300">Owner-verified Cash &amp; UPI</p>
              </div>
              <div>
                <p className="font-semibold text-white">Guest Loyalty</p>
                <p className="mt-1 text-stone-300">Per-venue member accounts</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
