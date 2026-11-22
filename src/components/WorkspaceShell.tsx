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

  const renderSidebarContent = () => (
    <div className="flex flex-col h-full bg-slate-900 text-slate-100">
      {/* Brand Lockup */}
      <div className="h-16 px-5 flex items-center justify-between border-b border-slate-800 shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          {brandLogoUrl ? (
            <SafeImage
              src={brandLogoUrl}
              alt={`${brandName} logo`}
              className="w-8 h-8 rounded-md object-cover shrink-0 border border-slate-700"
              accentColor={accentColor}
            />
          ) : (
            <div
              className="w-8 h-8 rounded-md flex items-center justify-center text-white text-sm font-bold shrink-0 font-display"
              style={{ backgroundColor: accentColor }}
            >
              {brandName.slice(0, 1).toUpperCase()}
            </div>
          )}
          <span className="font-display font-semibold text-base tracking-tight text-white truncate">
            {brandName}
          </span>
        </div>
        <button
          type="button"
          onClick={() => setMobileOpen(false)}
          className="lg:hidden p-1.5 text-slate-400 hover:text-white rounded-md"
          aria-label="Close navigation menu"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Navigation Links */}
      <nav className="flex-1 px-3 py-5 space-y-1 overflow-y-auto" aria-label="Workspace navigation">
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
              className={`w-full flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors duration-150 whitespace-nowrap ${
                isActive
                  ? 'bg-slate-800 text-white'
                  : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
              }`}
            >
              <span className="flex items-center gap-3 min-w-0">
                <Icon
                  className={`w-4 h-4 shrink-0 ${isActive ? 'text-white' : 'text-slate-400'}`}
                />
                <span className="truncate">{item.label}</span>
              </span>
              {typeof item.count === 'number' && (
                <span className="font-mono text-xs tabular-nums text-slate-400 shrink-0">
                  {item.count}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* Optional Footer Switcher + Account */}
      <div className="p-4 border-t border-slate-800 space-y-3 shrink-0">
        {sidebarFooterExtra}
        <div className="flex items-center justify-between gap-2 pt-1">
          <div className="min-w-0">
            <p className="text-xs font-medium text-white truncate">{roleLabel}</p>
            <p className="text-xs text-slate-400 truncate">{userEmail}</p>
          </div>
          <button
            type="button"
            onClick={onSignOut}
            title="Sign out"
            aria-label="Sign out"
            className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors shrink-0"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50 flex">
      {/* Desktop Fixed Slate Sidebar */}
      <aside className="hidden lg:block w-[248px] shrink-0 sticky top-0 h-screen">
        {renderSidebarContent()}
      </aside>

      {/* Mobile Drawer Overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden flex">
          <div
            className="fixed inset-0 bg-slate-950/50 backdrop-blur-[1px]"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="relative z-10 w-[264px] max-w-[82vw] h-full shadow-xl">
            {renderSidebarContent()}
          </aside>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Top Bar Contract: Breadcrumb Left + 1-2 Actions Right */}
        <header className="h-16 bg-white border-b border-slate-200 px-4 sm:px-6 lg:px-8 flex items-center justify-between gap-4 sticky top-0 z-20">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              className="lg:hidden p-2 -ml-2 text-slate-600 hover:text-slate-900 rounded-lg"
              aria-label="Open navigation menu"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2 text-sm min-w-0">
              <span className="text-slate-500 truncate hidden sm:inline">{breadcrumbSection}</span>
              <span className="text-slate-300 hidden sm:inline" aria-hidden="true">
                /
              </span>
              <h1 className="font-display font-semibold text-slate-900 truncate">
                {breadcrumbCurrent}
              </h1>
            </div>
          </div>

          {headerActions && (
            <div className="flex items-center gap-3 shrink-0">{headerActions}</div>
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
