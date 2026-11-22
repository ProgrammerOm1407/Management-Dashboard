import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Building2,
  ExternalLink,
  Plus,
  Search,
  Sparkles,
  X,
  LayoutDashboard,
  ClipboardList,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { WorkspaceShell } from '../components/WorkspaceShell';
import {
  createShopWithOwner,
  seedSampleVenue,
  subscribeAllShops,
  toggleShopActive,
  updateShopModules,
} from '../lib/firestoreService';
import { getShopTypeLabel, slugify } from '../lib/validation';
import { Shop, ShopModules, ShopType } from '../types';

const TYPE_OPTIONS: { value: ShopType; label: string }[] = [
  { value: 'cafe', label: 'Cafe' },
  { value: 'restaurant', label: 'Restaurant' },
  { value: 'hotel', label: 'Hotel' },
  { value: 'both', label: 'Hotel & Dining (Both)' },
];

const COLOR_PRESETS = ['#2563EB', '#0F766E', '#B45309', '#9F1239', '#4338CA', '#0F172A'];

export const SuperAdminPage: React.FC = () => {
  const { profile, signOutUser } = useAuth();
  const { pushToast } = useToast();
  const navigate = useNavigate();

  const [shops, setShops] = useState<Shop[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'suspended'>('all');

  // Create Shop Drawer State
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [slugTouched, setSlugTouched] = useState(false);

  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [type, setType] = useState<ShopType>('cafe');
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
        s.type.toLowerCase().includes(q)
      );
    });
  }, [shops, searchQuery, statusFilter]);

  const metrics = useMemo(() => {
    const total = shops.length;
    const active = shops.filter((s) => s.is_active).length;
    const suspended = total - active;
    const withRooms = shops.filter((s) => s.modules?.rooms).length;
    return { total, active, suspended, withRooms };
  }, [shops]);

  const resetForm = () => {
    setName('');
    setSlug('');
    setSlugTouched(false);
    setType('cafe');
    setPrimaryColor('#2563EB');
    setLogoUrl('');
    setDescription('');
    setModules({ menu: true, orders: true, rooms: false });
    setOwnerName('');
    setOwnerEmail('');
    setFormError(null);
  };

  const handleNameChange = (val: string) => {
    setName(val);
    if (!slugTouched) {
      setSlug(slugify(val));
    }
  };

  const handleTypeChange = (nextType: ShopType) => {
    setType(nextType);
    if (nextType === 'hotel') {
      setModules({ menu: false, orders: false, rooms: true });
    } else if (nextType === 'both') {
      setModules({ menu: true, orders: true, rooms: true });
    } else {
      setModules({ menu: true, orders: true, rooms: false });
    }
  };

  const handleCreateShop = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setSubmitting(true);
    try {
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
      pushToast('Shop onboarded', `${name.trim()} is live at /s/${slug.trim().toLowerCase()}`, 'success');
      resetForm();
      setDrawerOpen(false);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Unable to create shop.');
    } finally {
      setSubmitting(false);
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
        `${shop.name}: ${key.charAt(0).toUpperCase() + key.slice(1)} module ${updated[key] ? 'enabled' : 'disabled'}.`,
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

  return (
    <WorkspaceShell
      brandName="HostGrid"
      roleLabel="Super Admin"
      userEmail={profile?.email || ''}
      navItems={[{ id: 'shops', label: 'Tenant Shops', icon: Building2, count: shops.length }]}
      activeNavId="shops"
      onSelectNav={() => {}}
      breadcrumbSection="Platform Console"
      breadcrumbCurrent="Tenant Shops"
      onSignOut={() => void signOutUser()}
      headerActions={
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            disabled={seeding}
            onClick={() => void handleSeedSample()}
            className="hidden sm:inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 disabled:opacity-60 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Sparkles className="w-3.5 h-3.5 text-slate-500" />
            {seeding ? 'Creating...' : 'Load Sample Venue'}
          </button>
          <button
            type="button"
            onClick={() => {
              resetForm();
              setDrawerOpen(true);
            }}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            New Shop
          </button>
        </div>
      }
    >
      {/* Top KPI Summary Strip */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div className="bg-white border border-slate-200 rounded-lg p-5">
          <p className="text-xs font-medium text-slate-500">Total Shops</p>
          <p className="mt-2 font-mono text-2xl font-semibold text-slate-900 tabular-nums">
            {metrics.total}
          </p>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg p-5">
          <p className="text-xs font-medium text-slate-500">Active Tenants</p>
          <p className="mt-2 font-mono text-2xl font-semibold text-emerald-700 tabular-nums">
            {metrics.active}
          </p>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg p-5">
          <p className="text-xs font-medium text-slate-500">Suspended</p>
          <p className="mt-2 font-mono text-2xl font-semibold text-slate-700 tabular-nums">
            {metrics.suspended}
          </p>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg p-5">
          <p className="text-xs font-medium text-slate-500">Rooms Module Enabled</p>
          <p className="mt-2 font-mono text-2xl font-semibold text-slate-900 tabular-nums">
            {metrics.withRooms}
          </p>
        </div>
      </section>

      {/* Main Directory Surface */}
      <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        {/* Toolbar */}
        <div className="p-4 sm:px-6 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by shop name, slug, or owner email..."
              className="w-full pl-9 pr-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:bg-white focus:border-blue-600 focus:outline-none transition-colors"
            />
          </div>

          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg self-start sm:self-auto">
            {(['all', 'active', 'suspended'] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setStatusFilter(tab)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap capitalize cursor-pointer ${
                  statusFilter === tab
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {tab}
              </button>
            ))}
          </div>
        </div>

        {/* Table Content */}
        {loading ? (
          <div className="p-6 space-y-3">
            {[1, 2, 3].map((row) => (
              <div key={row} className="h-12 bg-slate-100 rounded animate-pulse" />
            ))}
          </div>
        ) : filteredShops.length === 0 ? (
          <div className="px-6 py-16 text-center max-w-md mx-auto">
            <Building2 className="w-8 h-8 text-slate-300 mx-auto mb-3" />
            <h2 className="text-base font-semibold text-slate-900">
              {shops.length === 0 ? 'No businesses onboarded yet' : 'No matching shops found'}
            </h2>
            <p className="mt-1.5 text-sm text-slate-600">
              {shops.length === 0
                ? 'Create your first cafe, restaurant, or hotel tenant to provision its isolated workspace and public storefront link.'
                : 'Adjust your search query or status filter to view other onboarded shops.'}
            </p>
            {shops.length === 0 && (
              <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
                <button
                  type="button"
                  onClick={() => {
                    resetForm();
                    setDrawerOpen(true);
                  }}
                  className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
                >
                  <Plus className="w-4 h-4" />
                  Create First Shop
                </button>
                <button
                  type="button"
                  disabled={seeding}
                  onClick={() => void handleSeedSample()}
                  className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors cursor-pointer"
                >
                  <Sparkles className="w-4 h-4 text-slate-500" />
                  {seeding ? 'Loading Sample...' : 'Load Sample Venue'}
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-medium text-slate-500">
                  <th className="py-3 px-6">Business</th>
                  <th className="py-3 px-4">Owner</th>
                  <th className="py-3 px-4">Modules</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-6 text-right">Workspaces & Preview</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-sm">
                {filteredShops.map((shop) => (
                  <tr
                    key={shop.id}
                    className="hover:bg-slate-50/80 transition-colors duration-100"
                  >
                    <td className="py-3.5 px-6">
                      <div className="flex items-center gap-3 min-w-[200px]">
                        <div
                          className="w-8 h-8 rounded-md flex items-center justify-center text-white font-display font-semibold text-xs shrink-0"
                          style={{ backgroundColor: shop.primary_color || '#2563EB' }}
                        >
                          {shop.name.slice(0, 1).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <p className="font-medium text-slate-900 truncate">{shop.name}</p>
                          <p className="text-xs text-slate-500 flex items-center gap-1.5 mt-0.5">
                            <span>{getShopTypeLabel(shop.type)}</span>
                            <span aria-hidden="true">·</span>
                            <span className="font-mono text-[11px]">/s/{shop.slug}</span>
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="py-3.5 px-4 text-slate-700 font-mono text-xs whitespace-nowrap">
                      {shop.owner_email}
                    </td>
                    <td className="py-3.5 px-4">
                      <div className="flex items-center gap-1.5">
                        {(['menu', 'orders', 'rooms'] as const).map((modKey) => {
                          const enabled = Boolean(shop.modules?.[modKey]);
                          return (
                            <button
                              key={modKey}
                              type="button"
                              onClick={() => void handleToggleModule(shop, modKey)}
                              title={`Toggle ${modKey} module for ${shop.name}`}
                              className={`px-2 py-1 text-xs font-medium rounded border transition-colors capitalize whitespace-nowrap cursor-pointer ${
                                enabled
                                  ? 'bg-slate-900 text-white border-slate-900'
                                  : 'bg-white text-slate-400 border-slate-200 hover:text-slate-700'
                              }`}
                            >
                              {modKey}
                            </button>
                          );
                        })}
                      </div>
                    </td>
                    <td className="py-3.5 px-4 whitespace-nowrap">
                      <div className="flex items-center gap-3">
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
                          className={`text-xs font-medium ${
                            shop.is_active ? 'text-emerald-700' : 'text-red-700'
                          }`}
                        >
                          {shop.is_active ? 'Active' : 'Suspended'}
                        </span>
                      </div>
                    </td>
                    <td className="py-3.5 px-6 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => navigate(`/dashboard?shop=${shop.id}`)}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-50 transition-colors cursor-pointer"
                        >
                          <LayoutDashboard className="w-3.5 h-3.5 text-slate-500" />
                          Owner
                        </button>
                        <button
                          type="button"
                          onClick={() => navigate(`/server?shop=${shop.id}`)}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-50 transition-colors cursor-pointer"
                        >
                          <ClipboardList className="w-3.5 h-3.5 text-slate-500" />
                          Server
                        </button>
                        <button
                          type="button"
                          onClick={() => navigate(`/s/${shop.slug}`)}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-blue-700 bg-blue-50/60 border border-blue-200 rounded-md hover:bg-blue-100/70 transition-colors cursor-pointer"
                        >
                          Preview
                          <ExternalLink className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Slide-Over Create Shop & Assign Owner Drawer */}
      {drawerOpen && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div
            className="fixed inset-0 bg-slate-950/40 backdrop-blur-[1px]"
            onClick={() => setDrawerOpen(false)}
          />
          <div className="relative z-10 w-full max-w-lg bg-white h-full shadow-2xl border-l border-slate-200 flex flex-col">
            <div className="px-6 py-5 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h2 className="font-display text-lg font-semibold text-slate-900">
                  Onboard New Shop
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Provision isolated tenant data, modules, and initial Shop Owner account.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                aria-label="Close drawer"
                className="p-2 text-slate-400 hover:text-slate-700 rounded-lg cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={(e) => void handleCreateShop(e)} className="flex-1 overflow-y-auto p-6 space-y-6">
              {formError && (
                <div className="p-3.5 rounded-lg border border-red-200 bg-red-50 text-xs text-red-700">
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
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:border-blue-600 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1.5">
                    Public URL Slug
                  </label>
                  <div className="flex items-center border border-slate-300 rounded-lg overflow-hidden focus-within:border-blue-600">
                    <span className="px-3 py-2 text-xs font-mono text-slate-500 bg-slate-50 border-r border-slate-200">
                      /s/
                    </span>
                    <input
                      type="text"
                      required
                      maxLength={64}
                      value={slug}
                      onChange={(e) => {
                        setSlugTouched(true);
                        setSlug(slugify(e.target.value));
                      }}
                      placeholder="harbor-roast"
                      className="flex-1 px-3 py-2 text-sm font-mono focus:outline-none"
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
                      onChange={(e) => handleTypeChange(e.target.value as ShopType)}
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white focus:border-blue-600 focus:outline-none"
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
                        className="w-9 h-9 rounded border border-slate-300 cursor-pointer p-0.5 bg-white"
                      />
                      <input
                        type="text"
                        value={primaryColor}
                        onChange={(e) => setPrimaryColor(e.target.value)}
                        maxLength={7}
                        className="flex-1 px-2.5 py-2 text-xs font-mono border border-slate-300 rounded-lg focus:border-blue-600 focus:outline-none"
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
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:border-blue-600 focus:outline-none"
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
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:border-blue-600 focus:outline-none resize-none"
                  />
                </div>
              </div>

              {/* Modules Toggle Section */}
              <div className="pt-4 border-t border-slate-200 space-y-3">
                <h3 className="text-xs font-semibold text-slate-900">Enabled Modules</h3>
                <p className="text-xs text-slate-500">
                  Controls which navigation sections and public features appear for this tenant.
                </p>

                <div className="divide-y divide-slate-200 border border-slate-200 rounded-lg">
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
                        className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-blue-600"
                      />
                    </label>
                  ))}
                </div>
              </div>

              {/* Assign Owner Section */}
              <div className="pt-4 border-t border-slate-200 space-y-4">
                <div>
                  <h3 className="text-xs font-semibold text-slate-900">Assign Shop Owner</h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    When this email signs in via Google at /login, they are automatically bound to
                    this shop with Owner privileges.
                  </p>
                </div>

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
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:border-blue-600 focus:outline-none"
                  />
                </div>

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
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:border-blue-600 focus:outline-none"
                  />
                </div>
              </div>

              <div className="pt-4 border-t border-slate-200 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setDrawerOpen(false)}
                  className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 text-sm font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 disabled:opacity-60 transition-colors cursor-pointer"
                >
                  {submitting ? 'Provisioning...' : 'Create Shop & Assign Owner'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </WorkspaceShell>
  );
};
