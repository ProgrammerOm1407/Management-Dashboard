import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  BedDouble,
  Building2,
  Check,
  CheckCircle2,
  ClipboardList,
  Copy,
  CreditCard,
  ExternalLink,
  Layers,
  LogOut,
  Menu as MenuIcon,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  PauseCircle,
  Pencil,
  Plus,
  Receipt,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  Trash2,
  UtensilsCrossed,
  X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import {
  createShopWithOwner,
  deleteShopBySuperAdmin,
  seedSampleVenue,
  subscribeAllShops,
  toggleShopActive,
  updateShopBySuperAdmin,
  updateShopModules,
} from '../lib/firestoreService';
import { buildPublicAppUrl } from '../lib/routing';
import { getShopTypeLabel, slugify } from '../lib/validation';
import { Shop, ShopModules, ShopType } from '../types';

type ConsoleSection = 'shops' | 'billing' | 'settings';

const TYPE_OPTIONS: { value: ShopType; label: string }[] = [
  { value: 'cafe', label: 'Cafe' },
  { value: 'restaurant', label: 'Restaurant' },
  { value: 'hotel', label: 'Hotel' },
  { value: 'both', label: 'Hotel & Dining' },
];

const COLOR_PRESETS = ['#2563EB', '#0F766E', '#B45309', '#9F1239', '#4338CA', '#0F172A'];

const MODULE_META: Record<
  keyof ShopModules,
  {
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    activeClass: string;
    iconClass: string;
  }
> = {
  menu: {
    label: 'Menu',
    icon: UtensilsCrossed,
    activeClass: 'bg-indigo-50 text-indigo-700 border-indigo-200/80 hover:bg-indigo-100/80',
    iconClass: 'text-indigo-600',
  },
  orders: {
    label: 'Orders',
    icon: Receipt,
    activeClass: 'bg-amber-50 text-amber-700 border-amber-200/80 hover:bg-amber-100/80',
    iconClass: 'text-amber-600',
  },
  rooms: {
    label: 'Rooms',
    icon: BedDouble,
    activeClass: 'bg-emerald-50 text-emerald-700 border-emerald-200/80 hover:bg-emerald-100/80',
    iconClass: 'text-emerald-600',
  },
};

function getShopTierName(shop: Shop): { name: string; badgeClass: string; summary: string } {
  const count =
    (shop.modules?.menu ? 1 : 0) +
    (shop.modules?.orders ? 1 : 0) +
    (shop.modules?.rooms ? 1 : 0);
  if (shop.modules?.rooms && (shop.modules?.menu || shop.modules?.orders)) {
    return {
      name: 'Full Suite',
      badgeClass: 'bg-indigo-50 text-indigo-700 border-indigo-200/80',
      summary: 'Dining + Rooms',
    };
  }
  if (shop.modules?.rooms) {
    return {
      name: 'Hospitality',
      badgeClass: 'bg-emerald-50 text-emerald-700 border-emerald-200/80',
      summary: 'Rooms & Desk',
    };
  }
  if (count >= 2) {
    return {
      name: 'Dining Pro',
      badgeClass: 'bg-amber-50 text-amber-700 border-amber-200/80',
      summary: 'Menu + Live Orders',
    };
  }
  return {
    name: 'Starter',
    badgeClass: 'bg-slate-100 text-slate-600 border-slate-200/80',
    summary: count === 1 ? 'Single Module' : 'Minimal',
  };
}

export const SuperAdminPage: React.FC = () => {
  const { profile, signOutUser } = useAuth();
  const { pushToast } = useToast();
  const navigate = useNavigate();

  // Navigation & Sidebar State
  const [activeSection, setActiveSection] = useState<ConsoleSection>('shops');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  // Tenant Data & Filters
  const [shops, setShops] = useState<Shop[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'suspended'>('all');

  // Row Overflow Dropdown Menu
  const [openMenuShopId, setOpenMenuShopId] = useState<string | null>(null);
  const menuContainerRef = useRef<HTMLDivElement | null>(null);

  // Create / Edit Shop Drawer State
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingShop, setEditingShop] = useState<Shop | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [slugTouched, setSlugTouched] = useState(false);

  // Delete Confirmation Modal State
  const [shopToDelete, setShopToDelete] = useState<Shop | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Platform Settings State (persisted locally for onboarding defaults)
  const [defaultVenueType, setDefaultVenueType] = useState<ShopType>(() => {
    try {
      const saved = localStorage.getItem('hostgrid_default_venue_type');
      if (saved === 'cafe' || saved === 'restaurant' || saved === 'hotel' || saved === 'both') {
        return saved;
      }
    } catch {
      // Ignore storage access errors
    }
    return 'cafe';
  });
  const [copiedLoginUrl, setCopiedLoginUrl] = useState(false);

  // Shop Form Fields
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [type, setType] = useState<ShopType>(defaultVenueType);
  const [primaryColor, setPrimaryColor] = useState('#2563EB');
  const [logoUrl, setLogoUrl] = useState('');
  const [description, setDescription] = useState('');
  const [modules, setModules] = useState<ShopModules>({
    menu: true,
    orders: true,
    rooms: false,
  });
  const [ownerName, setOwnerName] = useState('');
  const [ownerEmail, setOwnerEmail] = useState('');

  useEffect(() => {
    const unsub = subscribeAllShops(
      (list) => {
        setShops(list);
        setLoading(false);
      },
      () => {
        setLoading(false);
      }
    );
    return () => unsub();
  }, []);

  // Close row dropdown on outside click or Escape key
  useEffect(() => {
    if (!openMenuShopId) return;
    const handlePointerDown = (e: MouseEvent) => {
      if (menuContainerRef.current && !menuContainerRef.current.contains(e.target as Node)) {
        setOpenMenuShopId(null);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenMenuShopId(null);
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [openMenuShopId]);

  const filteredShops = useMemo(() => {
    return shops.filter((s) => {
      if (statusFilter === 'active' && !s.is_active) return false;
      if (statusFilter === 'suspended' && s.is_active) return false;
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      return (
        s.name.toLowerCase().includes(q) ||
        s.slug.toLowerCase().includes(q) ||
        s.owner_email.toLowerCase().includes(q) ||
        s.type.toLowerCase().includes(q) ||
        getShopTypeLabel(s.type).toLowerCase().includes(q)
      );
    });
  }, [shops, searchQuery, statusFilter]);

  const metrics = useMemo(() => {
    const total = shops.length;
    const active = shops.filter((s) => s.is_active).length;
    const suspended = total - active;
    const withRooms = shops.filter((s) => s.modules?.rooms).length;
    const withMenu = shops.filter((s) => s.modules?.menu).length;
    const withOrders = shops.filter((s) => s.modules?.orders).length;
    const withUpi = shops.filter((s) => s.accept_upi && s.upi_id).length;
    return { total, active, suspended, withRooms, withMenu, withOrders, withUpi };
  }, [shops]);

  const applyTypeDefaults = (nextType: ShopType) => {
    setType(nextType);
    if (nextType === 'hotel') {
      setModules({ menu: false, orders: false, rooms: true });
    } else if (nextType === 'both') {
      setModules({ menu: true, orders: true, rooms: true });
    } else {
      setModules({ menu: true, orders: true, rooms: false });
    }
  };

  const resetFormForCreate = () => {
    setEditingShop(null);
    setName('');
    setSlug('');
    setSlugTouched(false);
    applyTypeDefaults(defaultVenueType);
    setPrimaryColor('#2563EB');
    setLogoUrl('');
    setDescription('');
    setOwnerName('');
    setOwnerEmail('');
    setFormError(null);
  };

  const openCreateDrawer = () => {
    resetFormForCreate();
    setDrawerOpen(true);
  };

  const openEditDrawer = (shop: Shop) => {
    setOpenMenuShopId(null);
    setEditingShop(shop);
    setName(shop.name);
    setSlug(shop.slug);
    setSlugTouched(true);
    setType(shop.type);
    setPrimaryColor(shop.primary_color || '#2563EB');
    setLogoUrl(shop.logo_url || '');
    setDescription(shop.description || '');
    setModules({
      menu: Boolean(shop.modules?.menu),
      orders: Boolean(shop.modules?.orders),
      rooms: Boolean(shop.modules?.rooms),
    });
    setOwnerName('');
    setOwnerEmail(shop.owner_email);
    setFormError(null);
    setDrawerOpen(true);
  };

  const handleNameChange = (val: string) => {
    setName(val);
    if (!editingShop && !slugTouched) {
      setSlug(slugify(val));
    }
  };

  const handleSaveShop = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setSubmitting(true);
    try {
      if (editingShop) {
        await updateShopBySuperAdmin(editingShop, {
          name,
          type,
          logo_url: logoUrl,
          primary_color: primaryColor,
          description,
          modules,
          owner_email: ownerEmail,
        });
        pushToast('Shop updated', `${name.trim()} settings have been saved.`, 'success');
      } else {
        await createShopWithOwner({
          name,
          slug,
          type,
          logo_url: logoUrl,
          primary_color: primaryColor,
          description,
          modules,
          owner_name: ownerName,
          owner_email: ownerEmail,
        });
        pushToast(
          'Shop onboarded',
          `${name.trim()} is live at /s/${slug.trim().toLowerCase()}`,
          'success'
        );
      }
      setDrawerOpen(false);
      setEditingShop(null);
    } catch (err) {
      setFormError(
        err instanceof Error
          ? err.message
          : editingShop
            ? 'Unable to update shop.'
            : 'Unable to create shop.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!shopToDelete) return;
    setDeleting(true);
    try {
      await deleteShopBySuperAdmin(shopToDelete);
      pushToast(
        'Shop deleted',
        `${shopToDelete.name} (/s/${shopToDelete.slug}) has been removed.`,
        'info'
      );
      setShopToDelete(null);
    } catch (err) {
      pushToast(
        'Delete failed',
        err instanceof Error ? err.message : 'Unable to delete shop.',
        'error'
      );
    } finally {
      setDeleting(false);
    }
  };

  const handleToggleActive = async (shop: Shop) => {
    const nextState = !shop.is_active;
    try {
      await toggleShopActive(shop, nextState);
      pushToast(
        nextState ? 'Shop activated' : 'Shop suspended',
        `${shop.name} public storefront is now ${nextState ? 'active' : 'offline'}.`,
        nextState ? 'success' : 'info'
      );
    } catch (err) {
      pushToast(
        'Status update failed',
        err instanceof Error ? err.message : 'Could not update shop status.',
        'error'
      );
    }
  };

  const handleToggleModule = async (shop: Shop, key: keyof ShopModules) => {
    const updated: ShopModules = {
      ...shop.modules,
      [key]: !shop.modules[key],
    };
    try {
      await updateShopModules(shop, updated);
      pushToast(
        'Modules updated',
        `${shop.name}: ${key.charAt(0).toUpperCase() + key.slice(1)} module ${
          updated[key] ? 'enabled' : 'disabled'
        }.`,
        'info'
      );
    } catch (err) {
      pushToast(
        'Module update failed',
        err instanceof Error ? err.message : 'Could not update modules.',
        'error'
      );
    }
  };

  const handleSeedSample = async () => {
    if (!profile?.email) return;
    setSeeding(true);
    try {
      await seedSampleVenue(profile.email);
      pushToast(
        'Sample venue created',
        'Malabar Courtyard Cafe & Suites added with INR menu items, suites, and live orders.',
        'success'
      );
    } catch (err) {
      pushToast(
        'Could not load sample venue',
        err instanceof Error ? err.message : 'Please try again.',
        'error'
      );
    } finally {
      setSeeding(false);
    }
  };

  const handleSaveDefaultVenueType = (val: ShopType) => {
    setDefaultVenueType(val);
    try {
      localStorage.setItem('hostgrid_default_venue_type', val);
    } catch {
      // Ignore storage errors
    }
    pushToast(
      'Default preset updated',
      `New shops will default to ${getShopTypeLabel(val)}.`,
      'success'
    );
  };

  const handleCopyLoginUrl = async () => {
    const url = buildPublicAppUrl('/login');
    try {
      await navigator.clipboard.writeText(url);
      setCopiedLoginUrl(true);
      window.setTimeout(() => setCopiedLoginUrl(false), 2000);
    } catch {
      pushToast('Staff Login URL', url, 'info');
    }
  };

  const navItems: {
    id: ConsoleSection;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    count?: number;
  }[] = [
    { id: 'shops', label: 'Tenant Shops', icon: Building2, count: shops.length },
    { id: 'billing', label: 'Revenue & Plans', icon: CreditCard },
    { id: 'settings', label: 'Platform Settings', icon: Settings },
  ];

  const currentSectionTitle =
    activeSection === 'shops'
      ? 'Tenant Shops'
      : activeSection === 'billing'
        ? 'Revenue & Plans'
        : 'Platform Settings';

  const userInitial = (profile?.email || 'S').slice(0, 1).toUpperCase();

  const renderSidebar = (isMobile = false) => {
    const collapsed = !isMobile && sidebarCollapsed;
    return (
      <div className="flex flex-col h-full bg-white border-r border-[#E2E8F0] text-slate-900 select-none">
        {/* Brand Header */}
        <div
          className={`h-14 border-b border-[#E2E8F0] flex items-center shrink-0 ${
            collapsed ? 'justify-center px-2' : 'justify-between px-4'
          }`}
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-7 h-7 rounded-lg bg-slate-900 text-white flex items-center justify-center font-display font-bold text-xs shrink-0 shadow-xs">
              H
            </div>
            {!collapsed && (
              <span className="font-display font-semibold text-[15px] tracking-tight text-slate-900 truncate">
                HostGrid
              </span>
            )}
          </div>

          {isMobile ? (
            <button
              type="button"
              onClick={() => setMobileSidebarOpen(false)}
              aria-label="Close sidebar"
              className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-md transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          ) : (
            !collapsed && (
              <button
                type="button"
                onClick={() => setSidebarCollapsed(true)}
                title="Collapse sidebar"
                aria-label="Collapse sidebar"
                className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-md transition-colors cursor-pointer"
              >
                <PanelLeftClose className="w-4 h-4" />
              </button>
            )
          )}
        </div>

        {/* Navigation Links */}
        <nav
          className={`flex-1 py-3 space-y-1 overflow-y-auto ${collapsed ? 'px-2' : 'px-3'}`}
          aria-label="Platform Console navigation"
        >
          {collapsed && !isMobile && (
            <button
              type="button"
              onClick={() => setSidebarCollapsed(false)}
              title="Expand sidebar"
              aria-label="Expand sidebar"
              className="w-full h-9 mb-2 flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
            >
              <PanelLeftOpen className="w-4 h-4" />
            </button>
          )}

          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeSection === item.id;
            return (
              <button
                key={item.id}
                type="button"
                title={collapsed ? item.label : undefined}
                onClick={() => {
                  setActiveSection(item.id);
                  setMobileSidebarOpen(false);
                }}
                className={`w-full flex items-center rounded-lg text-[13px] font-medium transition-colors whitespace-nowrap cursor-pointer ${
                  collapsed ? 'justify-center h-9 px-0' : 'justify-between gap-2.5 px-2.5 py-2'
                } ${
                  isActive
                    ? 'bg-slate-100 text-slate-950 font-semibold'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                }`}
              >
                <span className="flex items-center gap-2.5 min-w-0">
                  <Icon
                    className={`w-4 h-4 shrink-0 ${
                      isActive ? 'text-slate-900' : 'text-slate-400'
                    }`}
                  />
                  {!collapsed && <span className="truncate">{item.label}</span>}
                </span>
                {!collapsed && typeof item.count === 'number' && (
                  <span
                    className={`font-mono text-[11px] tabular-nums px-1.5 py-0.5 rounded-md ${
                      isActive
                        ? 'bg-white text-slate-900 border border-[#E2E8F0]'
                        : 'text-slate-400'
                    }`}
                  >
                    {item.count}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* Pinned Super Admin Profile & Logout Footer */}
        <div className={`border-t border-[#E2E8F0] shrink-0 ${collapsed ? 'p-2' : 'p-3'}`}>
          {collapsed ? (
            <div className="flex flex-col items-center gap-2">
              <div
                title={profile?.email || 'Super Admin'}
                className="w-8 h-8 rounded-lg bg-slate-900 text-white font-display text-xs font-semibold flex items-center justify-center"
              >
                {userInitial}
              </div>
              <button
                type="button"
                onClick={() => void signOutUser()}
                title="Sign out"
                aria-label="Sign out"
                className="w-8 h-8 flex items-center justify-center text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
              >
                <LogOut className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg bg-[#F8FAFC] border border-[#E2E8F0]">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-7 h-7 rounded-md bg-slate-900 text-white font-display text-xs font-semibold flex items-center justify-center shrink-0">
                  {userInitial}
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-slate-900 truncate leading-tight">
                    Super Admin
                  </p>
                  <p
                    className="text-[11px] text-slate-500 truncate mt-0.5"
                    title={profile?.email || ''}
                  >
                    {profile?.email || ''}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => void signOutUser()}
                title="Sign out"
                aria-label="Sign out"
                className="p-1.5 text-slate-400 hover:text-slate-900 hover:bg-slate-200/70 rounded-md transition-colors shrink-0 cursor-pointer"
              >
                <LogOut className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen w-full flex bg-[#F8FAFC] text-slate-900">
      {/* Desktop Collapsible 240px Sidebar */}
      <aside
        className={`hidden lg:block sticky top-0 h-screen shrink-0 transition-[width] duration-200 ${
          sidebarCollapsed ? 'w-[68px]' : 'w-[240px]'
        }`}
      >
        {renderSidebar(false)}
      </aside>

      {/* Mobile Sidebar Overlay */}
      {mobileSidebarOpen && (
        <div className="fixed inset-0 z-40 lg:hidden flex">
          <div
            className="fixed inset-0 bg-slate-950/35 backdrop-blur-[2px]"
            onClick={() => setMobileSidebarOpen(false)}
          />
          <aside className="relative z-10 w-[240px] max-w-[82vw] h-full shadow-xl">
            {renderSidebar(true)}
          </aside>
        </div>
      )}

      {/* Main Content Column */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Top Bar */}
        <header className="h-14 bg-white/95 backdrop-blur-sm border-b border-[#E2E8F0] px-4 sm:px-6 lg:px-8 flex items-center justify-between gap-4 sticky top-0 z-20">
          <div className="flex items-center gap-2.5 min-w-0">
            <button
              type="button"
              onClick={() => setMobileSidebarOpen(true)}
              aria-label="Open navigation menu"
              className="lg:hidden p-1.5 -ml-1.5 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-md transition-colors cursor-pointer"
            >
              <MenuIcon className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2 text-sm min-w-0">
              <span className="text-slate-500 hidden sm:inline font-medium whitespace-nowrap">
                Platform Console
              </span>
              <span className="text-slate-300 hidden sm:inline" aria-hidden="true">
                /
              </span>
              <h1 className="font-display font-semibold text-slate-900 tracking-tight truncate">
                {currentSectionTitle}
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              disabled={seeding}
              onClick={() => void handleSeedSample()}
              className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-[#E2E8F0] rounded-lg hover:bg-slate-50 hover:border-slate-300 disabled:opacity-60 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Sparkles className="w-3.5 h-3.5 text-slate-500" />
              {seeding ? 'Creating...' : 'Load Sample Venue'}
            </button>
            <button
              type="button"
              onClick={openCreateDrawer}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer shadow-xs"
            >
              <Plus className="w-3.5 h-3.5" />
              New Shop
            </button>
          </div>
        </header>

        {/* Main Viewport */}
        <main className="flex-1 w-full max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 py-6">
          {activeSection === 'shops' && (
            <>
              {/* 4 KPI Stat Cards */}
              <section className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                <div className="bg-white border border-[#E2E8F0] rounded-xl p-4 sm:p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-medium text-slate-500 truncate">Total Shops</p>
                    <div className="w-8 h-8 rounded-lg bg-slate-100 text-slate-600 border border-slate-200/70 flex items-center justify-center shrink-0">
                      <Building2 className="w-4 h-4" />
                    </div>
                  </div>
                  <p className="mt-3 font-mono text-2xl leading-none font-semibold text-slate-900 tabular-nums">
                    {metrics.total}
                  </p>
                </div>

                <div className="bg-white border border-[#E2E8F0] rounded-xl p-4 sm:p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-medium text-slate-500 truncate">Active Tenants</p>
                    <div className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-600 border border-emerald-200/70 flex items-center justify-center shrink-0">
                      <CheckCircle2 className="w-4 h-4" />
                    </div>
                  </div>
                  <p className="mt-3 font-mono text-2xl leading-none font-semibold text-emerald-700 tabular-nums">
                    {metrics.active}
                  </p>
                </div>

                <div className="bg-white border border-[#E2E8F0] rounded-xl p-4 sm:p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-medium text-slate-500 truncate">Suspended</p>
                    <div className="w-8 h-8 rounded-lg bg-rose-50 text-rose-600 border border-rose-200/70 flex items-center justify-center shrink-0">
                      <PauseCircle className="w-4 h-4" />
                    </div>
                  </div>
                  <p className="mt-3 font-mono text-2xl leading-none font-semibold text-slate-900 tabular-nums">
                    {metrics.suspended}
                  </p>
                </div>

                <div className="bg-white border border-[#E2E8F0] rounded-xl p-4 sm:p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-medium text-slate-500 truncate">
                      Rooms Module Enabled
                    </p>
                    <div className="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-600 border border-indigo-200/70 flex items-center justify-center shrink-0">
                      <BedDouble className="w-4 h-4" />
                    </div>
                  </div>
                  <p className="mt-3 font-mono text-2xl leading-none font-semibold text-slate-900 tabular-nums">
                    {metrics.withRooms}
                  </p>
                </div>
              </section>

              {/* Main Directory Table Surface */}
              <section className="bg-white border border-[#E2E8F0] rounded-xl shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
                {/* Filter & Search Toolbar */}
                <div className="px-4 py-3.5 sm:px-5 border-b border-[#E2E8F0] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="relative flex-1 max-w-md">
                    <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Search by shop name, slug, or owner email..."
                      className="w-full pl-9 pr-3 py-1.5 text-sm bg-[#F8FAFC] border border-[#E2E8F0] rounded-lg placeholder:text-slate-400 focus:bg-white focus:border-slate-900 focus:outline-none transition-colors"
                    />
                  </div>

                  <div className="inline-flex items-center gap-1 p-1 bg-slate-100/90 border border-[#E2E8F0] rounded-lg self-start sm:self-auto">
                    {(['all', 'active', 'suspended'] as const).map((tab) => (
                      <button
                        key={tab}
                        type="button"
                        onClick={() => setStatusFilter(tab)}
                        className={`px-3 py-1 text-xs font-medium rounded-md transition-all duration-150 whitespace-nowrap capitalize cursor-pointer ${
                          statusFilter === tab
                            ? 'bg-white text-slate-900 shadow-xs font-semibold'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        {tab}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Directory Content */}
                {loading ? (
                  <div className="p-5 space-y-2.5">
                    {[1, 2, 3].map((row) => (
                      <div key={row} className="h-12 bg-slate-100 rounded-lg animate-pulse" />
                    ))}
                  </div>
                ) : filteredShops.length === 0 ? (
                  <div className="px-6 py-16 text-center max-w-md mx-auto">
                    <Building2 className="w-8 h-8 text-slate-300 mx-auto mb-3" />
                    <h2 className="text-base font-semibold text-slate-900">
                      {shops.length === 0 ? 'No businesses onboarded yet' : 'No matching shops found'}
                    </h2>
                    <p className="mt-1.5 text-sm text-slate-500">
                      {shops.length === 0
                        ? 'Create your first cafe, restaurant, or hotel tenant to provision its isolated workspace and public storefront link.'
                        : 'Adjust your search query or status filter to view other onboarded shops.'}
                    </p>
                    {shops.length === 0 && (
                      <div className="mt-6 flex flex-wrap items-center justify-center gap-2.5">
                        <button
                          type="button"
                          onClick={openCreateDrawer}
                          className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
                        >
                          <Plus className="w-4 h-4" />
                          Create First Shop
                        </button>
                        <button
                          type="button"
                          disabled={seeding}
                          onClick={() => void handleSeedSample()}
                          className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-[#E2E8F0] rounded-lg hover:bg-slate-50 transition-colors cursor-pointer"
                        >
                          <Sparkles className="w-3.5 h-3.5 text-slate-500" />
                          {seeding ? 'Loading Sample...' : 'Load Sample Venue'}
                        </button>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="overflow-x-auto lg:overflow-visible">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="border-b border-[#E2E8F0] bg-[#F8FAFC] text-[11px] font-medium text-slate-500">
                          <th className="py-2.5 pl-5 pr-3">Business</th>
                          <th className="py-2.5 px-3">Owner</th>
                          <th className="py-2.5 px-3 w-px whitespace-nowrap">Modules</th>
                          <th className="py-2.5 px-3 w-px whitespace-nowrap">Status</th>
                          <th className="py-2.5 pl-3 pr-5 text-right w-px whitespace-nowrap">
                            Actions
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#E2E8F0] text-sm">
                        {filteredShops.map((shop, rowIndex) => {
                          const isMenuOpen = openMenuShopId === shop.id;
                          const openUpward =
                            filteredShops.length > 2 && rowIndex >= filteredShops.length - 2;
                          return (
                            <tr
                              key={shop.id}
                              className="hover:bg-slate-50/75 transition-colors duration-100"
                            >
                              {/* Business Column: Bold Name Line 1, Type Badge + Clickable Slug Line 2 */}
                              <td className="py-3 pl-5 pr-3 max-w-[240px] xl:max-w-[340px]">
                                <div className="flex items-center gap-3 min-w-0">
                                  <div
                                    className="w-8 h-8 rounded-lg flex items-center justify-center text-white font-display font-semibold text-xs shrink-0 shadow-xs"
                                    style={{ backgroundColor: shop.primary_color || '#2563EB' }}
                                  >
                                    {shop.name.slice(0, 1).toUpperCase()}
                                  </div>
                                  <div className="min-w-0 flex-1">
                                    <p
                                      className="font-semibold text-[13.5px] text-slate-900 truncate leading-snug"
                                      title={shop.name}
                                    >
                                      {shop.name}
                                    </p>
                                    <div className="mt-1 flex items-center gap-1.5 min-w-0 flex-nowrap">
                                      <span className="inline-flex items-center px-1.5 py-0.5 text-[11px] font-medium rounded-md bg-slate-100 text-slate-600 border border-slate-200/70 whitespace-nowrap shrink-0 leading-none">
                                        {getShopTypeLabel(shop.type)}
                                      </span>
                                      <button
                                        type="button"
                                        onClick={() => navigate(`/s/${shop.slug}`)}
                                        title={`Open /s/${shop.slug}`}
                                        className="font-mono text-[11px] text-slate-500 hover:text-indigo-600 hover:underline whitespace-nowrap truncate min-w-0 cursor-pointer transition-colors text-left"
                                      >
                                        /s/{shop.slug}
                                      </button>
                                    </div>
                                  </div>
                                </div>
                              </td>

                              {/* Owner Email Column */}
                              <td className="py-3 px-3 max-w-[160px] xl:max-w-[220px]">
                                <p
                                  className="text-slate-600 font-mono text-xs truncate"
                                  title={shop.owner_email}
                                >
                                  {shop.owner_email}
                                </p>
                              </td>

                              {/* Soft Tinted Module Badges with Icons */}
                              <td className="py-3 px-3 w-px whitespace-nowrap">
                                <div className="inline-flex items-center gap-1.5">
                                  {(['menu', 'orders', 'rooms'] as const).map((modKey) => {
                                    const enabled = Boolean(shop.modules?.[modKey]);
                                    const meta = MODULE_META[modKey];
                                    const ModIcon = meta.icon;
                                    return (
                                      <button
                                        key={modKey}
                                        type="button"
                                        onClick={() => void handleToggleModule(shop, modKey)}
                                        title={`${enabled ? 'Disable' : 'Enable'} ${meta.label} module for ${shop.name}`}
                                        className={`inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded-md border transition-colors whitespace-nowrap cursor-pointer ${
                                          enabled
                                            ? meta.activeClass
                                            : 'bg-slate-50/70 text-slate-400 border-slate-200/80 hover:text-slate-600 hover:bg-slate-100/80'
                                        }`}
                                      >
                                        <ModIcon
                                          className={`w-3 h-3 shrink-0 ${
                                            enabled ? meta.iconClass : 'text-slate-400 opacity-75'
                                          }`}
                                        />
                                        <span>{meta.label}</span>
                                      </button>
                                    );
                                  })}
                                </div>
                              </td>

                              {/* Status Toggle Column */}
                              <td className="py-3 px-3 w-px whitespace-nowrap">
                                <div className="inline-flex items-center gap-2">
                                  <button
                                    type="button"
                                    role="switch"
                                    aria-checked={shop.is_active}
                                    aria-label={`Toggle active status for ${shop.name}`}
                                    onClick={() => void handleToggleActive(shop)}
                                    className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full transition-colors duration-150 ${
                                      shop.is_active ? 'bg-emerald-600' : 'bg-slate-300'
                                    }`}
                                  >
                                    <span
                                      className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-xs transition-transform duration-150 mt-0.5 ${
                                        shop.is_active ? 'translate-x-4.5' : 'translate-x-0.5'
                                      }`}
                                    />
                                  </button>
                                  <span
                                    className={`text-xs font-medium w-[62px] ${
                                      shop.is_active ? 'text-emerald-700' : 'text-rose-600'
                                    }`}
                                  >
                                    {shop.is_active ? 'Active' : 'Suspended'}
                                  </span>
                                </div>
                              </td>

                              {/* Compact Right Action Group: Open Store Icon + Owner + Three-Dot Menu */}
                              <td className="py-3 pl-3 pr-5 text-right w-px whitespace-nowrap">
                                <div
                                  className="relative inline-flex items-center justify-end gap-1.5"
                                  ref={isMenuOpen ? menuContainerRef : undefined}
                                >
                                  <button
                                    type="button"
                                    onClick={() => navigate(`/s/${shop.slug}`)}
                                    title="Open Store"
                                    aria-label={`Open public store for ${shop.name}`}
                                    className="w-8 h-8 inline-flex items-center justify-center text-slate-500 hover:text-indigo-600 bg-white border border-[#E2E8F0] hover:border-indigo-200 hover:bg-indigo-50/50 rounded-lg transition-colors cursor-pointer"
                                  >
                                    <ExternalLink className="w-3.5 h-3.5" />
                                  </button>

                                  <button
                                    type="button"
                                    onClick={() => navigate(`/dashboard?shop=${shop.id}`)}
                                    className="h-8 px-2.5 inline-flex items-center justify-center text-xs font-medium text-slate-700 hover:text-slate-950 bg-white border border-[#E2E8F0] hover:border-slate-300 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
                                  >
                                    Owner
                                  </button>

                                  <button
                                    type="button"
                                    aria-haspopup="menu"
                                    aria-expanded={isMenuOpen}
                                    aria-label={`More actions for ${shop.name}`}
                                    onClick={() =>
                                      setOpenMenuShopId((prev) =>
                                        prev === shop.id ? null : shop.id
                                      )
                                    }
                                    className={`w-8 h-8 inline-flex items-center justify-center rounded-lg border transition-colors cursor-pointer ${
                                      isMenuOpen
                                        ? 'bg-slate-100 text-slate-900 border-slate-300'
                                        : 'bg-white text-slate-500 border-[#E2E8F0] hover:text-slate-900 hover:bg-slate-50 hover:border-slate-300'
                                    }`}
                                  >
                                    <MoreHorizontal className="w-4 h-4" />
                                  </button>

                                  {isMenuOpen && (
                                    <div
                                      role="menu"
                                      className={`absolute right-0 w-44 bg-white border border-[#E2E8F0] rounded-xl shadow-[0_12px_32px_-8px_rgba(15,23,42,0.14)] py-1 z-30 text-left ${
                                        openUpward ? 'bottom-full mb-1.5' : 'top-full mt-1.5'
                                      }`}
                                    >
                                      <button
                                        type="button"
                                        role="menuitem"
                                        onClick={() => {
                                          setOpenMenuShopId(null);
                                          navigate(`/server?shop=${shop.id}`);
                                        }}
                                        className="w-full px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 hover:text-slate-950 flex items-center gap-2 transition-colors cursor-pointer"
                                      >
                                        <ClipboardList className="w-3.5 h-3.5 text-slate-400" />
                                        Server View
                                      </button>
                                      <button
                                        type="button"
                                        role="menuitem"
                                        onClick={() => openEditDrawer(shop)}
                                        className="w-full px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 hover:text-slate-950 flex items-center gap-2 transition-colors cursor-pointer"
                                      >
                                        <Pencil className="w-3.5 h-3.5 text-slate-400" />
                                        Edit Shop
                                      </button>
                                      <div className="my-1 border-t border-slate-100" />
                                      <button
                                        type="button"
                                        role="menuitem"
                                        onClick={() => {
                                          setOpenMenuShopId(null);
                                          setShopToDelete(shop);
                                        }}
                                        className="w-full px-3 py-2 text-xs font-medium text-rose-600 hover:bg-rose-50 flex items-center gap-2 transition-colors cursor-pointer"
                                      >
                                        <Trash2 className="w-3.5 h-3.5 text-rose-500" />
                                        Delete
                                      </button>
                                    </div>
                                  )}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </>
          )}

          {activeSection === 'billing' && (
            <div className="space-y-6">
              {/* Module Adoption & Entitlements Overview */}
              <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="bg-white border border-[#E2E8F0] rounded-xl p-4 sm:p-5">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-medium text-slate-500">Menu Module Active</p>
                    <div className="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-600 border border-indigo-200/70 flex items-center justify-center shrink-0">
                      <UtensilsCrossed className="w-4 h-4" />
                    </div>
                  </div>
                  <p className="mt-3 font-mono text-2xl font-semibold text-slate-900 tabular-nums">
                    {metrics.withMenu}
                    <span className="text-xs font-normal text-slate-400 ml-1">
                      / {metrics.total}
                    </span>
                  </p>
                </div>

                <div className="bg-white border border-[#E2E8F0] rounded-xl p-4 sm:p-5">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-medium text-slate-500">Orders Module Active</p>
                    <div className="w-8 h-8 rounded-lg bg-amber-50 text-amber-600 border border-amber-200/70 flex items-center justify-center shrink-0">
                      <Receipt className="w-4 h-4" />
                    </div>
                  </div>
                  <p className="mt-3 font-mono text-2xl font-semibold text-slate-900 tabular-nums">
                    {metrics.withOrders}
                    <span className="text-xs font-normal text-slate-400 ml-1">
                      / {metrics.total}
                    </span>
                  </p>
                </div>

                <div className="bg-white border border-[#E2E8F0] rounded-xl p-4 sm:p-5">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-medium text-slate-500">Rooms Module Active</p>
                    <div className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-600 border border-emerald-200/70 flex items-center justify-center shrink-0">
                      <BedDouble className="w-4 h-4" />
                    </div>
                  </div>
                  <p className="mt-3 font-mono text-2xl font-semibold text-slate-900 tabular-nums">
                    {metrics.withRooms}
                    <span className="text-xs font-normal text-slate-400 ml-1">
                      / {metrics.total}
                    </span>
                  </p>
                </div>

                <div className="bg-white border border-[#E2E8F0] rounded-xl p-4 sm:p-5">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-medium text-slate-500">UPI Payments Enabled</p>
                    <div className="w-8 h-8 rounded-lg bg-slate-100 text-slate-600 border border-slate-200/70 flex items-center justify-center shrink-0">
                      <CreditCard className="w-4 h-4" />
                    </div>
                  </div>
                  <p className="mt-3 font-mono text-2xl font-semibold text-slate-900 tabular-nums">
                    {metrics.withUpi}
                    <span className="text-xs font-normal text-slate-400 ml-1">
                      / {metrics.total}
                    </span>
                  </p>
                </div>
              </section>

              {/* Tenant Plan & Module Entitlements Table */}
              <section className="bg-white border border-[#E2E8F0] rounded-xl overflow-hidden">
                <div className="px-5 py-4 border-b border-[#E2E8F0] flex items-center justify-between gap-4">
                  <div>
                    <h2 className="font-display text-sm font-semibold text-slate-900">
                      Tenant Plan & Module Entitlements
                    </h2>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Live tier allocation derived from each shop&apos;s active module footprint and
                      payment configuration.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setActiveSection('shops')}
                    className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-[#E2E8F0] rounded-lg hover:bg-slate-50 cursor-pointer whitespace-nowrap"
                  >
                    Manage Tenants
                  </button>
                </div>

                {shops.length === 0 ? (
                  <div className="p-12 text-center text-sm text-slate-500">
                    Onboard a tenant shop to inspect its module entitlements and payment channels.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="border-b border-[#E2E8F0] bg-[#F8FAFC] text-[11px] font-medium text-slate-500">
                          <th className="py-2.5 pl-5 pr-3">Tenant</th>
                          <th className="py-2.5 px-3">Plan Tier</th>
                          <th className="py-2.5 px-3">Payment Channels</th>
                          <th className="py-2.5 px-3">Status</th>
                          <th className="py-2.5 pl-3 pr-5 text-right">Configure</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#E2E8F0] text-sm">
                        {shops.map((shop) => {
                          const tier = getShopTierName(shop);
                          return (
                            <tr key={shop.id} className="hover:bg-slate-50/75">
                              <td className="py-3 pl-5 pr-3">
                                <p className="font-semibold text-slate-900 text-[13px]">
                                  {shop.name}
                                </p>
                                <p className="text-xs text-slate-500 font-mono">{shop.owner_email}</p>
                              </td>
                              <td className="py-3 px-3 whitespace-nowrap">
                                <span
                                  className={`inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium rounded-md border ${tier.badgeClass}`}
                                >
                                  <Layers className="w-3 h-3" />
                                  {tier.name}
                                </span>
                                <span className="ml-2 text-xs text-slate-500">{tier.summary}</span>
                              </td>
                              <td className="py-3 px-3 text-xs text-slate-600 whitespace-nowrap">
                                {[
                                  shop.accept_cash !== false && 'Cash',
                                  shop.accept_upi && shop.upi_id && 'Dynamic UPI',
                                ]
                                  .filter(Boolean)
                                  .join(' · ') || 'Cash'}
                              </td>
                              <td className="py-3 px-3 whitespace-nowrap">
                                <span
                                  className={`text-xs font-medium ${
                                    shop.is_active ? 'text-emerald-700' : 'text-rose-600'
                                  }`}
                                >
                                  {shop.is_active ? 'Active' : 'Suspended'}
                                </span>
                              </td>
                              <td className="py-3 pl-3 pr-5 text-right whitespace-nowrap">
                                <button
                                  type="button"
                                  onClick={() => openEditDrawer(shop)}
                                  className="px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-white border border-[#E2E8F0] rounded-lg hover:bg-slate-50 cursor-pointer"
                                >
                                  Edit Modules
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </div>
          )}

          {activeSection === 'settings' && (
            <div className="grid lg:grid-cols-12 gap-6 items-start">
              <div className="lg:col-span-7 space-y-6">
                {/* Onboarding Defaults */}
                <section className="bg-white border border-[#E2E8F0] rounded-xl p-5 sm:p-6 space-y-4">
                  <div className="border-b border-[#E2E8F0] pb-3.5">
                    <h2 className="font-display text-sm font-semibold text-slate-900">
                      Tenant Onboarding Presets
                    </h2>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Choose the default business template pre-selected whenever you click New Shop.
                    </p>
                  </div>

                  <div className="grid sm:grid-cols-2 gap-3">
                    {TYPE_OPTIONS.map((opt) => {
                      const selected = defaultVenueType === opt.value;
                      return (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => handleSaveDefaultVenueType(opt.value)}
                          className={`p-3.5 rounded-lg border text-left transition-colors cursor-pointer ${
                            selected
                              ? 'bg-slate-900 text-white border-slate-900'
                              : 'bg-[#F8FAFC] text-slate-700 border-[#E2E8F0] hover:bg-slate-100/80'
                          }`}
                        >
                          <p className="text-xs font-semibold">{opt.label}</p>
                          <p
                            className={`text-[11px] mt-1 ${
                              selected ? 'text-slate-300' : 'text-slate-500'
                            }`}
                          >
                            {opt.value === 'hotel'
                              ? 'Enables Rooms module by default'
                              : opt.value === 'both'
                                ? 'Enables Menu, Orders, and Rooms'
                                : 'Enables Menu and Live Orders'}
                          </p>
                        </button>
                      );
                    })}
                  </div>
                </section>

                {/* Staff Login & Routing URL */}
                <section className="bg-white border border-[#E2E8F0] rounded-xl p-5 sm:p-6 space-y-4">
                  <div className="border-b border-[#E2E8F0] pb-3.5">
                    <h2 className="font-display text-sm font-semibold text-slate-900">
                      Portal Access URL
                    </h2>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Share this sign-in URL with newly assigned Shop Owners and Servers.
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      readOnly
                      value={buildPublicAppUrl('/login')}
                      className="flex-1 px-3 py-2 text-xs font-mono bg-[#F8FAFC] border border-[#E2E8F0] rounded-lg text-slate-700 truncate"
                    />
                    <button
                      type="button"
                      onClick={() => void handleCopyLoginUrl()}
                      className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-[#E2E8F0] rounded-lg hover:bg-slate-50 shrink-0 cursor-pointer"
                    >
                      {copiedLoginUrl ? (
                        <Check className="w-3.5 h-3.5 text-emerald-600" />
                      ) : (
                        <Copy className="w-3.5 h-3.5 text-slate-500" />
                      )}
                      {copiedLoginUrl ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                </section>
              </div>

              {/* Super Admin Identity Card */}
              <aside className="lg:col-span-5 bg-white border border-[#E2E8F0] rounded-xl p-5 sm:p-6 space-y-4">
                <div className="flex items-center gap-2.5 border-b border-[#E2E8F0] pb-3.5">
                  <div className="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-600 border border-indigo-200/70 flex items-center justify-center">
                    <ShieldCheck className="w-4 h-4" />
                  </div>
                  <div>
                    <h2 className="font-display text-sm font-semibold text-slate-900">
                      Platform Governance
                    </h2>
                    <p className="text-xs text-slate-500">Super Admin access & isolation</p>
                  </div>
                </div>

                <dl className="space-y-3 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <dt className="text-slate-500">Signed-in Admin</dt>
                    <dd className="font-mono text-slate-900 truncate">{profile?.email || '—'}</dd>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <dt className="text-slate-500">Tenant Isolation</dt>
                    <dd className="font-medium text-emerald-700">Firestore Per-Shop RBAC</dd>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <dt className="text-slate-500">Managed Tenants</dt>
                    <dd className="font-mono font-semibold text-slate-900 tabular-nums">
                      {metrics.total} ({metrics.active} active)
                    </dd>
                  </div>
                </dl>
              </aside>
            </div>
          )}
        </main>
      </div>

      {/* Slide-Over Create / Edit Shop Drawer */}
      {drawerOpen && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div
            className="fixed inset-0 bg-slate-950/35 backdrop-blur-[2px]"
            onClick={() => setDrawerOpen(false)}
          />
          <div className="relative z-10 w-full max-w-lg bg-white border-l border-[#E2E8F0] shadow-2xl h-full flex flex-col">
            <div className="px-6 py-4 border-b border-[#E2E8F0] flex items-center justify-between">
              <div>
                <h2 className="font-display text-base font-semibold text-slate-900">
                  {editingShop ? `Edit ${editingShop.name}` : 'Onboard New Shop'}
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  {editingShop
                    ? 'Update business profile, enabled modules, and assigned owner email.'
                    : 'Provision isolated tenant data, modules, and initial Shop Owner account.'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                aria-label="Close drawer"
                className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form
              onSubmit={(e) => void handleSaveShop(e)}
              className="flex-1 overflow-y-auto p-6 space-y-6"
            >
              {formError && (
                <div className="p-3 rounded-lg border border-rose-200 bg-rose-50 text-xs text-rose-700">
                  {formError}
                </div>
              )}

              <div className="space-y-4">
                <h3 className="text-xs font-semibold text-slate-900">Business Identity</h3>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1.5">
                    Business Name
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={100}
                    value={name}
                    onChange={(e) => handleNameChange(e.target.value)}
                    placeholder="e.g. Harbor Roast & Bistro"
                    className="w-full px-3 py-2 text-sm border border-[#E2E8F0] rounded-lg focus:border-slate-900 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1.5">
                    Public URL Slug
                    {editingShop && (
                      <span className="ml-1.5 font-normal text-slate-400">(fixed after creation)</span>
                    )}
                  </label>
                  <div
                    className={`flex items-center border border-[#E2E8F0] rounded-lg overflow-hidden ${
                      editingShop ? 'bg-slate-50 opacity-75' : 'focus-within:border-slate-900'
                    }`}
                  >
                    <span className="px-3 py-2 text-xs font-mono text-slate-500 bg-[#F8FAFC] border-r border-[#E2E8F0]">
                      /s/
                    </span>
                    <input
                      type="text"
                      required
                      disabled={Boolean(editingShop)}
                      maxLength={64}
                      value={slug}
                      onChange={(e) => {
                        setSlugTouched(true);
                        setSlug(slugify(e.target.value));
                      }}
                      placeholder="harbor-roast"
                      className="flex-1 px-3 py-2 text-sm font-mono bg-transparent focus:outline-none disabled:cursor-not-allowed"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1.5">
                      Business Type
                    </label>
                    <select
                      value={type}
                      onChange={(e) => {
                        const next = e.target.value as ShopType;
                        if (editingShop) {
                          setType(next);
                        } else {
                          applyTypeDefaults(next);
                        }
                      }}
                      className="w-full px-3 py-2 text-sm border border-[#E2E8F0] rounded-lg bg-white focus:border-slate-900 focus:outline-none"
                    >
                      {TYPE_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1.5">
                      Primary Brand Color
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        value={primaryColor}
                        onChange={(e) => setPrimaryColor(e.target.value)}
                        className="w-9 h-9 rounded-lg border border-[#E2E8F0] cursor-pointer p-0.5 bg-white"
                      />
                      <input
                        type="text"
                        value={primaryColor}
                        onChange={(e) => setPrimaryColor(e.target.value)}
                        maxLength={7}
                        className="flex-1 px-2.5 py-2 text-xs font-mono border border-[#E2E8F0] rounded-lg focus:border-slate-900 focus:outline-none"
                      />
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {COLOR_PRESETS.map((hex) => (
                    <button
                      key={hex}
                      type="button"
                      onClick={() => setPrimaryColor(hex)}
                      aria-label={`Select color ${hex}`}
                      className={`w-6 h-6 rounded-md transition-transform cursor-pointer ${
                        primaryColor.toLowerCase() === hex.toLowerCase()
                          ? 'ring-2 ring-offset-2 ring-slate-900 scale-105'
                          : ''
                      }`}
                      style={{ backgroundColor: hex }}
                    />
                  ))}
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1.5">
                    Logo URL (Optional)
                  </label>
                  <input
                    type="text"
                    maxLength={500}
                    value={logoUrl}
                    onChange={(e) => setLogoUrl(e.target.value)}
                    placeholder="https://example.com/logo.png"
                    className="w-full px-3 py-2 text-sm border border-[#E2E8F0] rounded-lg focus:border-slate-900 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1.5">
                    Short Description (Optional)
                  </label>
                  <textarea
                    rows={2}
                    maxLength={400}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Shown on the public storefront header."
                    className="w-full px-3 py-2 text-sm border border-[#E2E8F0] rounded-lg focus:border-slate-900 focus:outline-none resize-none"
                  />
                </div>
              </div>

              {/* Modules Toggle Section */}
              <div className="pt-4 border-t border-[#E2E8F0] space-y-3">
                <h3 className="text-xs font-semibold text-slate-900">Enabled Modules</h3>
                <p className="text-xs text-slate-500">
                  Controls which navigation sections and public features appear for this tenant.
                </p>

                <div className="divide-y divide-[#E2E8F0] border border-[#E2E8F0] rounded-lg overflow-hidden">
                  {[
                    {
                      key: 'menu' as const,
                      title: 'Menu Catalog',
                      desc: 'Manage dishes, categories, prices, and availability.',
                    },
                    {
                      key: 'orders' as const,
                      title: 'Real-Time Orders',
                      desc: 'Live guest ordering, server kitchen board, and order notifications.',
                    },
                    {
                      key: 'rooms' as const,
                      title: 'Rooms & Bookings',
                      desc: 'Hotel room inventory and owner-only guest reservation management.',
                    },
                  ].map((item) => (
                    <label
                      key={item.key}
                      className="flex items-center justify-between gap-4 p-3.5 cursor-pointer hover:bg-slate-50"
                    >
                      <div>
                        <p className="text-sm font-medium text-slate-900">{item.title}</p>
                        <p className="text-xs text-slate-500">{item.desc}</p>
                      </div>
                      <input
                        type="checkbox"
                        checked={modules[item.key]}
                        onChange={(e) =>
                          setModules((prev) => ({ ...prev, [item.key]: e.target.checked }))
                        }
                        className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-900"
                      />
                    </label>
                  ))}
                </div>
              </div>

              {/* Assign Owner Section */}
              <div className="pt-4 border-t border-[#E2E8F0] space-y-4">
                <div>
                  <h3 className="text-xs font-semibold text-slate-900">
                    {editingShop ? 'Shop Owner Email' : 'Assign Shop Owner'}
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    When this email signs in via Google at /login, they are bound to this shop with
                    Owner privileges.
                  </p>
                </div>

                {!editingShop && (
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1.5">
                      Owner Full Name
                    </label>
                    <input
                      type="text"
                      required
                      maxLength={100}
                      value={ownerName}
                      onChange={(e) => setOwnerName(e.target.value)}
                      placeholder="e.g. Jordan Ellis"
                      className="w-full px-3 py-2 text-sm border border-[#E2E8F0] rounded-lg focus:border-slate-900 focus:outline-none"
                    />
                  </div>
                )}

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1.5">
                    Owner Google Email
                  </label>
                  <input
                    type="email"
                    required
                    maxLength={200}
                    value={ownerEmail}
                    onChange={(e) => setOwnerEmail(e.target.value)}
                    placeholder="owner@business.com"
                    className="w-full px-3 py-2 text-sm border border-[#E2E8F0] rounded-lg focus:border-slate-900 focus:outline-none"
                  />
                </div>
              </div>

              <div className="pt-4 border-t border-[#E2E8F0] flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setDrawerOpen(false)}
                  className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-[#E2E8F0] rounded-lg hover:bg-slate-50 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 text-xs font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 disabled:opacity-60 transition-colors cursor-pointer"
                >
                  {submitting
                    ? editingShop
                      ? 'Saving...'
                      : 'Provisioning...'
                    : editingShop
                      ? 'Save Changes'
                      : 'Create Shop & Assign Owner'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Shop Confirmation Modal */}
      {shopToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="fixed inset-0 bg-slate-950/35 backdrop-blur-[2px]"
            onClick={() => !deleting && setShopToDelete(null)}
          />
          <div className="relative z-10 w-full max-w-md bg-white border border-[#E2E8F0] rounded-xl shadow-2xl overflow-hidden">
            <div className="p-6 space-y-3">
              <div className="w-10 h-10 rounded-lg bg-rose-50 border border-rose-200/80 text-rose-600 flex items-center justify-center">
                <Trash2 className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-display text-base font-semibold text-slate-900">
                  Delete {shopToDelete.name}?
                </h3>
                <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                  This permanently removes the tenant record and public storefront link{' '}
                  <span className="font-mono text-slate-900">/s/{shopToDelete.slug}</span> along
                  with its staff invitations. This action cannot be undone.
                </p>
              </div>
            </div>
            <div className="px-6 py-3.5 bg-[#F8FAFC] border-t border-[#E2E8F0] flex items-center justify-end gap-2.5">
              <button
                type="button"
                disabled={deleting}
                onClick={() => setShopToDelete(null)}
                className="px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-[#E2E8F0] rounded-lg hover:bg-slate-50 disabled:opacity-50 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={deleting}
                onClick={() => void handleConfirmDelete()}
                className="px-3.5 py-2 text-xs font-semibold text-white bg-rose-600 rounded-lg hover:bg-rose-700 disabled:opacity-60 transition-colors cursor-pointer"
              >
                {deleting ? 'Deleting...' : 'Delete Shop'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
