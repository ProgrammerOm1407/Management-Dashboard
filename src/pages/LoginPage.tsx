import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, LogOut, ShieldCheck } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { DEFAULT_HERO_IMAGE } from '../types';
import { SafeImage } from '../components/SafeImage';

export const LoginPage: React.FC = () => {
  const { user, profile, loading, unprovisioned, authError, signInWithGoogle, signOutUser, refreshProfile } =
    useAuth();
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
    <div className="min-h-screen bg-slate-50 grid lg:grid-cols-12 items-stretch">
      {/* Left Column: Crisp Authentication Panel */}
      <div className="lg:col-span-5 bg-white border-r border-slate-200 flex flex-col justify-between p-8 sm:p-12 lg:p-16">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-slate-900 text-white font-display font-bold text-base flex items-center justify-center">
            H
          </div>
          <span className="font-display font-bold text-lg tracking-tight text-slate-900">
            HostGrid
          </span>
        </div>

        <div className="my-12 max-w-md w-full">
          <p className="text-xs font-medium text-slate-500 mb-3">
            Multi-tenant hospitality operations
          </p>
          <h1 className="font-display text-3xl sm:text-4xl font-bold tracking-tight text-slate-900 leading-tight">
            Sign in to your venue workspace
          </h1>
          <p className="mt-3 text-sm sm:text-base text-slate-600 leading-relaxed">
            Access your Super Admin console, Shop Owner dashboard, or real-time Server order queue.
            You will be routed automatically based on your assigned role.
          </p>

          {authError && (
            <div className="mt-6 p-4 rounded-lg border border-red-200 bg-red-50 text-sm text-red-700">
              {authError}
            </div>
          )}

          {unprovisioned && user ? (
            <div className="mt-8 p-5 rounded-lg border border-amber-200 bg-amber-50/70 space-y-4">
              <div>
                <h2 className="text-sm font-semibold text-slate-900">
                  No workspace invitation found
                </h2>
                <p className="mt-1 text-sm text-slate-600 leading-relaxed">
                  Signed in as <span className="font-mono text-slate-900">{user.email}</span>, which
                  is not yet assigned to a shop. Ask your Platform Super Admin or Shop Owner to
                  invite this email address, then check again.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => void refreshProfile()}
                  className="px-4 py-2 text-sm font-medium text-white bg-slate-900 rounded-lg hover:bg-slate-800 transition-colors whitespace-nowrap"
                >
                  Check Invitation Again
                </button>
                <button
                  type="button"
                  onClick={() => void signOutUser()}
                  className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors whitespace-nowrap"
                >
                  <LogOut className="w-4 h-4" />
                  Switch Account
                </button>
              </div>
            </div>
          ) : (
            <div className="mt-8 space-y-5">
              <button
                type="button"
                disabled={loading}
                onClick={() => void signInWithGoogle()}
                className="w-full flex items-center justify-center gap-3 px-5 py-3 text-sm font-semibold text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-60 rounded-lg transition-colors duration-150 cursor-pointer"
              >
                <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    fill="#ffffff"
                    d="M21.35 11.1h-9.18v2.98h5.27c-.23 1.24-.92 2.29-1.96 3v2.49h3.17c1.86-1.71 2.93-4.23 2.93-7.21 0-.43-.04-.85-.23-1.26z"
                  />
                  <path
                    fill="#e2e8f0"
                    d="M12.17 22c2.65 0 4.88-.88 6.51-2.38l-3.17-2.49c-.88.59-2 .94-3.34.94-2.57 0-4.74-1.73-5.52-4.06H3.38v2.57A9.83 9.83 0 0 0 12.17 22z"
                  />
                  <path
                    fill="#cbd5e1"
                    d="M6.65 14.01a5.91 5.91 0 0 1 0-3.77V7.67H3.38a9.84 9.84 0 0 0 0 8.91l3.27-2.57z"
                  />
                  <path
                    fill="#f8fafc"
                    d="M12.17 6.18c1.44 0 2.74.5 3.76 1.47l2.82-2.82C17.04 3.24 14.82 2.25 12.17 2.25a9.83 9.83 0 0 0-8.79 5.42l3.27 2.57c.78-2.33 2.95-4.06 5.52-4.06z"
                  />
                </svg>
                <span>{loading ? 'Verifying session...' : 'Continue with Google'}</span>
                <ArrowRight className="w-4 h-4 shrink-0" />
              </button>

              <div className="pt-5 border-t border-slate-200 grid grid-cols-3 gap-4 text-xs text-slate-500">
                <div>
                  <p className="font-medium text-slate-900">Super Admin</p>
                  <p className="mt-0.5 font-mono text-[11px]">/super-admin</p>
                </div>
                <div>
                  <p className="font-medium text-slate-900">Shop Owner</p>
                  <p className="mt-0.5 font-mono text-[11px]">/dashboard</p>
                </div>
                <div>
                  <p className="font-medium text-slate-900">Server Staff</p>
                  <p className="mt-0.5 font-mono text-[11px]">/server</p>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 text-xs text-slate-500">
          <ShieldCheck className="w-4 h-4 text-slate-400 shrink-0" />
          <span>Tenant isolation enforced per shop ID and verified role</span>
        </div>
      </div>

      {/* Right Column: Editorial Hospitality Visual Anchor */}
      <div className="hidden lg:block lg:col-span-7 relative overflow-hidden bg-slate-900">
        <SafeImage
          src={DEFAULT_HERO_IMAGE}
          alt="Modern specialty cafe and hospitality venue interior"
          className="w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-slate-950/85 via-slate-950/30 to-slate-950/15" />
        <div className="absolute inset-x-0 bottom-0 p-12 text-white max-w-2xl">
          <p className="text-xs font-medium text-slate-300">
            Cafes · Restaurants · Boutique Hotels
          </p>
          <h2 className="mt-2 font-display text-3xl font-bold tracking-tight leading-snug">
            One unified SaaS codebase for every storefront, kitchen queue, and guest room.
          </h2>
          <p className="mt-3 text-sm text-slate-300 leading-relaxed">
            Configure modular workspaces per venue, stream live orders directly from public links to
            floor servers, and monitor daily revenue and top-performing menu items in real time.
          </p>
        </div>
      </div>
    </div>
  );
};
