import React, { useState } from 'react';
import { LogOut, Menu, X } from 'lucide-react';
import { SafeImage } from './SafeImage';

export interface NavItem {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  count?: number;
}

interface WorkspaceShellProps {
  brandName: string;
  brandLogoUrl?: string;
  accentColor?: string;
  roleLabel: string;
  userEmail: string;
  navItems: NavItem[];
  activeNavId: string;
  onSelectNav: (id: string) => void;
  breadcrumbSection: string;
  breadcrumbCurrent: string;
  headerActions?: React.ReactNode;
  sidebarFooterExtra?: React.ReactNode;
  onSignOut: () => void;
  children: React.ReactNode;
}

export const WorkspaceShell: React.FC<WorkspaceShellProps> = ({
  brandName,
  brandLogoUrl,
  accentColor = '#2563EB',
  roleLabel,
  userEmail,
  navItems,
  activeNavId,
  onSelectNav,
  breadcrumbSection,
  breadcrumbCurrent,
  headerActions,
  sidebarFooterExtra,
  onSignOut,
  children,
}) => {
  const [mobileOpen, setMobileOpen] = useState(false);

  const initials = (userEmail || roleLabel).slice(0, 1).toUpperCase();

  const renderSidebarContent = () => (
    <div className="flex flex-col h-full bg-[#111315]/95 backdrop-blur-xl text-stone-100 border-r border-white/[0.08] shadow-[inset_-1px_0_0_rgba(255,255,255,0.04)]">
      {/* Brand Lockup */}
      <div className="h-16 px-5 flex items-center justify-between border-b border-white/[0.08] shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          {brandLogoUrl ? (
            <SafeImage
              src={brandLogoUrl}
              alt={`${brandName} logo`}
              className="w-8 h-8 rounded-lg object-cover shrink-0 ring-1 ring-white/15"
              accentColor={accentColor}
            />
          ) : (
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center text-white text-sm font-bold shrink-0 font-display shadow-xs ring-1 ring-white/15"
              style={{ backgroundColor: accentColor }}
            >
              {brandName.slice(0, 1).toUpperCase()}
            </div>
          )}
          <span className="font-display font-semibold text-[15px] tracking-tight text-white truncate">
            {brandName}
          </span>
        </div>
        <button
          type="button"
          onClick={() => setMobileOpen(false)}
          className="lg:hidden p-1.5 text-stone-400 hover:text-white hover:bg-white/10 rounded-lg transition-colors cursor-pointer"
          aria-label="Close navigation menu"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Navigation Links */}
      <nav
        className="flex-1 px-3 py-4 space-y-1 overflow-y-auto"
        aria-label="Workspace navigation"
      >
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = item.id === activeNavId;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                onSelectNav(item.id);
                setMobileOpen(false);
              }}
              className={`group w-full flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl text-[13px] font-medium transition-all duration-150 whitespace-nowrap cursor-pointer ${
                isActive
                  ? 'bg-white/[0.10] text-white border border-white/[0.08] shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]'
                  : 'text-stone-400 border border-transparent hover:text-stone-100 hover:bg-white/[0.04]'
              }`}
            >
              <span className="flex items-center gap-3 min-w-0">
                <span
                  className={`flex items-center justify-center w-5 h-5 rounded-md transition-colors ${
                    isActive ? 'text-white' : 'text-stone-500 group-hover:text-stone-300'
                  }`}
                  style={isActive ? { color: '#ffffff' } : undefined}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                </span>
                <span className="truncate">{item.label}</span>
              </span>
              {typeof item.count === 'number' && (
                <span
                  className={`font-mono text-[11px] tabular-nums shrink-0 ${
                    isActive ? 'text-stone-200 font-semibold' : 'text-stone-500'
                  }`}
                >
                  {item.count}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* Footer Switcher + Account Card */}
      <div className="p-3.5 border-t border-white/[0.08] space-y-3 shrink-0 bg-black/20">
        {sidebarFooterExtra}
        <div className="flex items-center justify-between gap-2.5 px-2.5 py-2 rounded-xl bg-white/[0.06] border border-white/[0.08]">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-7 h-7 rounded-lg bg-white/10 border border-white/15 text-stone-100 font-display text-xs font-semibold flex items-center justify-center shrink-0">
              {initials}
            </div>
            <div className="min-w-0">
              <p className="text-xs font-medium text-stone-100 truncate leading-tight">
                {roleLabel}
              </p>
              <p className="text-[11px] text-stone-400 truncate mt-0.5">{userEmail}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onSignOut}
            title="Sign out"
            aria-label="Sign out"
            className="p-1.5 text-stone-400 hover:text-white hover:bg-white/10 rounded-md transition-colors shrink-0 cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen flex">
      {/* Desktop Fixed Obsidian Sidebar */}
      <aside className="hidden lg:block w-[256px] shrink-0 sticky top-0 h-screen">
        {renderSidebarContent()}
      </aside>

      {/* Mobile Drawer Overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden flex">
          <div
            className="fixed inset-0 glass-backdrop"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="relative z-10 w-[268px] max-w-[84vw] h-full shadow-2xl">
            {renderSidebarContent()}
          </aside>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Top Bar Contract: Breadcrumb Left + 1-2 Actions Right */}
        <header className="h-16 glass-bar px-4 sm:px-6 lg:px-8 flex items-center justify-between gap-4 sticky top-0 z-20">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              className="lg:hidden p-2 -ml-2 text-stone-600 hover:text-stone-900 hover:bg-stone-100 rounded-lg transition-colors cursor-pointer"
              aria-label="Open navigation menu"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2 text-sm min-w-0">
              <span className="text-stone-500 truncate hidden sm:inline font-medium">
                {breadcrumbSection}
              </span>
              <span className="text-stone-300 hidden sm:inline" aria-hidden="true">
                /
              </span>
              <h1 className="font-display font-semibold text-stone-900 tracking-tight truncate">
                {breadcrumbCurrent}
              </h1>
            </div>
          </div>

          {headerActions && (
            <div className="flex items-center gap-2.5 shrink-0">{headerActions}</div>
          )}
        </header>

        {/* Viewport Container */}
        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-[1600px] w-full mx-auto">
          {children}
        </main>
      </div>
    </div>
  );
};
