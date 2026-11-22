import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Edit2,
  Lock,
  Minus,
  PackageCheck,
  Plus,
  Search,
  Trash2,
  UtensilsCrossed,
  X,
} from 'lucide-react';
import { MenuItem, Shop } from '../../types';
import {
  createMenuItem,
  DEFAULT_LOW_STOCK_THRESHOLD,
  deleteMenuItem,
  updateMenuItem,
  updateMenuItemStock,
} from '../../lib/firestoreService';
import { formatCurrency } from '../../lib/validation';
import { SafeImage } from '../SafeImage';
import { useToast } from '../../context/ToastContext';

interface MenuManagerProps {
  shop: Shop;
  items: MenuItem[];
  loading: boolean;
  readOnly?: boolean;
}

type StockFilter = 'all' | 'low_stock' | 'out_of_stock' | 'in_stock';
type StockState = 'out_of_stock' | 'low_stock' | 'in_stock' | 'untracked';

function getMenuStockMeta(item: MenuItem): {
  state: StockState;
  threshold: number;
  hasCount: boolean;
  isZeroStock: boolean;
} {
  const threshold =
    typeof item.low_stock_threshold === 'number' && item.low_stock_threshold >= 1
      ? item.low_stock_threshold
      : DEFAULT_LOW_STOCK_THRESHOLD;
  const hasCount = typeof item.stock_count === 'number';
  const isZeroStock = hasCount && item.stock_count === 0;

  if (isZeroStock || !item.is_available) {
    return { state: 'out_of_stock', threshold, hasCount, isZeroStock };
  }
  if (hasCount && (item.stock_count as number) <= threshold) {
    return { state: 'low_stock', threshold, hasCount, isZeroStock };
  }
  if (hasCount) {
    return { state: 'in_stock', threshold, hasCount, isZeroStock };
  }
  return { state: 'untracked', threshold, hasCount, isZeroStock };
}

export const MenuManager: React.FC<MenuManagerProps> = ({
  shop,
  items,
  loading,
  readOnly = false,
}) => {
  const { pushToast } = useToast();
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [stockFilter, setStockFilter] = useState<StockFilter>('all');

  const [modalOpen, setModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<MenuItem | null>(null);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Inline manual inventory editing state
  const [updatingStockId, setUpdatingStockId] = useState<string | null>(null);
  const [draftStockValues, setDraftStockValues] = useState<Record<string, string>>({});

  // Modal Form Fields
  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [price, setPrice] = useState('');
  const [description, setDescription] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [isAvailable, setIsAvailable] = useState(true);
  const [trackInventory, setTrackInventory] = useState(false);
  const [stockCountInput, setStockCountInput] = useState('15');
  const [lowStockThresholdInput, setLowStockThresholdInput] = useState(
    String(DEFAULT_LOW_STOCK_THRESHOLD)
  );

  const categories = useMemo(() => {
    const set = new Set<string>();
    items.forEach((i) => set.add(i.category));
    return ['All', ...Array.from(set).sort()];
  }, [items]);

  const stockSummary = useMemo(() => {
    let lowStock = 0;
    let outOfStock = 0;
    let inStock = 0;
    items.forEach((item) => {
      const meta = getMenuStockMeta(item);
      if (meta.state === 'out_of_stock') outOfStock += 1;
      else if (meta.state === 'low_stock') lowStock += 1;
      else inStock += 1;
    });
    return { total: items.length, lowStock, outOfStock, inStock };
  }, [items]);

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      if (selectedCategory !== 'All' && item.category !== selectedCategory) return false;

      const meta = getMenuStockMeta(item);
      if (stockFilter === 'low_stock' && meta.state !== 'low_stock') return false;
      if (stockFilter === 'out_of_stock' && meta.state !== 'out_of_stock') return false;
      if (stockFilter === 'in_stock' && meta.state === 'out_of_stock') return false;

      if (!search.trim()) return true;
      const q = search.toLowerCase();
      return (
        item.name.toLowerCase().includes(q) ||
        item.description.toLowerCase().includes(q) ||
        item.category.toLowerCase().includes(q)
      );
    });
  }, [items, search, selectedCategory, stockFilter]);

  const openCreateModal = () => {
    setEditingItem(null);
    setName('');
    setCategory(categories[1] || 'Chai & Coffee');
    setPrice('');
    setDescription('');
    setImageUrl('');
    setIsAvailable(true);
    setTrackInventory(true);
    setStockCountInput('15');
    setLowStockThresholdInput(String(DEFAULT_LOW_STOCK_THRESHOLD));
    setErrorMsg(null);
    setModalOpen(true);
  };

  const openEditModal = (item: MenuItem) => {
    setEditingItem(item);
    setName(item.name);
    setCategory(item.category);
    setPrice(String(item.price));
    setDescription(item.description);
    setImageUrl(item.image_url);
    setIsAvailable(item.is_available);
    const hasStock = typeof item.stock_count === 'number';
    setTrackInventory(hasStock);
    setStockCountInput(hasStock ? String(item.stock_count) : '15');
    setLowStockThresholdInput(
      String(item.low_stock_threshold ?? DEFAULT_LOW_STOCK_THRESHOLD)
    );
    setErrorMsg(null);
    setModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (readOnly) return;
    setErrorMsg(null);

    let parsedStock: number | null = null;
    let parsedThreshold = DEFAULT_LOW_STOCK_THRESHOLD;

    if (trackInventory) {
      const rawCount = Number(stockCountInput);
      if (stockCountInput.trim() === '' || !Number.isFinite(rawCount) || rawCount < 0) {
        setErrorMsg('Enter a valid non-negative whole number for stock count.');
        return;
      }
      parsedStock = Math.min(99999, Math.floor(rawCount));

      const rawThreshold = Number(lowStockThresholdInput);
      if (
        lowStockThresholdInput.trim() === '' ||
        !Number.isFinite(rawThreshold) ||
        rawThreshold < 1
      ) {
        setErrorMsg('Low stock alert threshold must be at least 1.');
        return;
      }
      parsedThreshold = Math.min(9999, Math.floor(rawThreshold));
    }

    setSaving(true);
    try {
      const payload = {
        name,
        category,
        description,
        price: Number(price),
        image_url: imageUrl,
        is_available: parsedStock === 0 ? false : isAvailable,
        stock_count: parsedStock,
        low_stock_threshold: parsedThreshold,
      };
      if (editingItem) {
        await updateMenuItem(shop.id, editingItem.id, payload);
        pushToast(
          parsedStock === 0 ? 'Item marked out of stock' : 'Menu item updated',
          parsedStock === 0
            ? `${name.trim()} stock is 0 and has been hidden from ordering.`
            : `${name.trim()} changes saved.`,
          parsedStock === 0 ? 'info' : 'success'
        );
      } else {
        await createMenuItem(shop.id, payload);
        pushToast('Menu item added', `${name.trim()} is now listed on the menu.`, 'success');
      }
      setModalOpen(false);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to save menu item.');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleAvailable = async (item: MenuItem) => {
    if (readOnly) return;
    const meta = getMenuStockMeta(item);

    // If item is out of stock due to 0 count, prompt quick restock via + button or restock directly
    if (meta.isZeroStock && !item.is_available) {
      await handleCommitStock(item, Math.max(meta.threshold + 5, 10));
      return;
    }

    try {
      await updateMenuItem(shop.id, item.id, {
        name: item.name,
        category: item.category,
        description: item.description,
        price: item.price,
        image_url: item.image_url,
        is_available: !item.is_available,
        stock_count: item.stock_count ?? null,
        low_stock_threshold: meta.threshold,
      });
      pushToast(
        item.is_available ? 'Marked out of stock' : 'Marked available',
        item.name,
        'info'
      );
    } catch (err) {
      pushToast('Update failed', err instanceof Error ? err.message : 'Try again.', 'error');
    }
  };

  const handleCommitStock = async (item: MenuItem, nextCount: number | null) => {
    if (readOnly) return;
    const meta = getMenuStockMeta(item);
    const clampedCount =
      nextCount === null ? null : Math.max(0, Math.min(99999, Math.floor(nextCount)));

    if (clampedCount === (item.stock_count ?? null)) {
      setDraftStockValues((prev) => {
        const copy = { ...prev };
        delete copy[item.id];
        return copy;
      });
      return;
    }

    setUpdatingStockId(item.id);
    try {
      const result = await updateMenuItemStock(
        shop.id,
        item.id,
        clampedCount,
        meta.threshold,
        item.is_available,
        meta.isZeroStock
      );
      setDraftStockValues((prev) => {
        const copy = { ...prev };
        delete copy[item.id];
        return copy;
      });

      if (result.stockCount === 0) {
        pushToast(
          'Marked out of stock',
          `${item.name} reached 0 in stock and is hidden from ordering.`,
          'info'
        );
      } else if (
        result.stockCount !== null &&
        meta.isZeroStock &&
        result.stockCount > 0
      ) {
        pushToast(
          'Item restocked',
          `${item.name} is back on the menu (${result.stockCount} in stock).`,
          'success'
        );
      } else if (
        result.stockCount !== null &&
        result.stockCount <= meta.threshold
      ) {
        pushToast(
          'Low stock alert',
          `${item.name} has only ${result.stockCount} left (threshold ≤ ${meta.threshold}).`,
          'info'
        );
      }
    } catch (err) {
      pushToast(
        'Stock update failed',
        err instanceof Error ? err.message : 'Unable to update stock count.',
        'error'
      );
    } finally {
      setUpdatingStockId(null);
    }
  };

  const handleDelete = async (item: MenuItem) => {
    if (readOnly) return;
    try {
      await deleteMenuItem(shop.id, item.id);
      pushToast('Item removed', `${item.name} deleted from menu.`, 'info');
    } catch (err) {
      pushToast('Delete failed', err instanceof Error ? err.message : 'Try again.', 'error');
    }
  };

  const modalParsedStock = Number(stockCountInput);
  const modalParsedThreshold = Math.max(1, Number(lowStockThresholdInput) || DEFAULT_LOW_STOCK_THRESHOLD);
  const modalWillBeZero =
    trackInventory &&
    stockCountInput.trim() !== '' &&
    Number.isFinite(modalParsedStock) &&
    Math.floor(modalParsedStock) <= 0;
  const modalWillBeLow =
    trackInventory &&
    !modalWillBeZero &&
    stockCountInput.trim() !== '' &&
    Number.isFinite(modalParsedStock) &&
    Math.floor(modalParsedStock) <= modalParsedThreshold;

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h2 className="font-display text-lg font-semibold text-slate-900">Menu Catalog</h2>
            {readOnly && (
              <span className="inline-flex items-center gap-1 text-xs text-slate-500">
                <Lock className="w-3.5 h-3.5" />
                Read-only for servers
              </span>
            )}
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            {readOnly
              ? 'Reference active menu items, pricing, and remaining stock counts while taking orders.'
              : 'Manage menu offerings, update manual inventory counts, and catch low or out-of-stock items.'}
          </p>
        </div>

        {!readOnly && (
          <button
            type="button"
            onClick={openCreateModal}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white rounded-lg hover:opacity-95 transition-opacity whitespace-nowrap self-start sm:self-auto cursor-pointer"
            style={{ backgroundColor: shop.primary_color || '#0F172A' }}
          >
            <Plus className="w-4 h-4" />
            Add Menu Item
          </button>
        )}
      </div>

      {/* Low Stock / Out of Stock Alert Banner */}
      {!loading && (stockSummary.lowStock > 0 || stockSummary.outOfStock > 0) && (
        <div className="bg-amber-50/70 border border-amber-200 rounded-lg px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start sm:items-center gap-2.5 text-xs">
            <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5 sm:mt-0" />
            <div className="text-slate-800">
              <span className="font-semibold text-slate-900">Inventory alerts:</span>{' '}
              {stockSummary.lowStock > 0 && (
                <span className="font-medium text-amber-800 font-mono tabular-nums">
                  {stockSummary.lowStock} low stock
                </span>
              )}
              {stockSummary.lowStock > 0 && stockSummary.outOfStock > 0 && (
                <span className="text-slate-400 mx-1.5">·</span>
              )}
              {stockSummary.outOfStock > 0 && (
                <span className="font-medium text-red-700 font-mono tabular-nums">
                  {stockSummary.outOfStock} out of stock
                </span>
              )}
              <span className="text-slate-600 ml-1.5 hidden md:inline">
                — Items at 0 stock are automatically hidden from guest ordering.
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3 text-xs shrink-0">
            {stockSummary.lowStock > 0 && (
              <button
                type="button"
                onClick={() =>
                  setStockFilter((prev) => (prev === 'low_stock' ? 'all' : 'low_stock'))
                }
                className="font-semibold text-amber-800 hover:underline underline-offset-4 whitespace-nowrap cursor-pointer"
              >
                {stockFilter === 'low_stock' ? 'Show all' : 'Review low stock'}
              </button>
            )}
            {stockSummary.outOfStock > 0 && (
              <button
                type="button"
                onClick={() =>
                  setStockFilter((prev) => (prev === 'out_of_stock' ? 'all' : 'out_of_stock'))
                }
                className="font-semibold text-red-700 hover:underline underline-offset-4 whitespace-nowrap cursor-pointer"
              >
                {stockFilter === 'out_of_stock' ? 'Show all' : 'Review out of stock'}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Filter Toolbar & Table */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="p-4 border-b border-slate-200 space-y-3">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div className="relative flex-1 max-w-sm">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search dishes, beverages, or categories..."
                className="w-full pl-9 pr-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:bg-white focus:border-blue-600 focus:outline-none"
              />
            </div>

            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg overflow-x-auto max-w-full">
              {categories.map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setSelectedCategory(cat)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    selectedCategory === cat
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>

          {/* Inventory Status Filter Row */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-100">
            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg overflow-x-auto max-w-full">
              {(
                [
                  { id: 'all', label: 'All Items', count: stockSummary.total },
                  { id: 'low_stock', label: 'Low Stock', count: stockSummary.lowStock },
                  { id: 'out_of_stock', label: 'Out of Stock', count: stockSummary.outOfStock },
                  { id: 'in_stock', label: 'Available', count: stockSummary.inStock + stockSummary.lowStock },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setStockFilter(tab.id)}
                  className={`inline-flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    stockFilter === tab.id
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <span>{tab.label}</span>
                  <span
                    className={`font-mono text-[11px] tabular-nums ${
                      tab.id === 'low_stock' && tab.count > 0
                        ? 'text-amber-700 font-semibold'
                        : tab.id === 'out_of_stock' && tab.count > 0
                          ? 'text-red-700 font-semibold'
                          : 'text-slate-400'
                    }`}
                  >
                    {tab.count}
                  </span>
                </button>
              ))}
            </div>

            {!readOnly && (
              <p className="text-[11px] text-slate-500">
                Adjust counts inline with <span className="font-mono">− / +</span> or type a quantity and press Enter.
              </p>
            )}
          </div>
        </div>

        {loading ? (
          <div className="p-6 space-y-3">
            {[1, 2, 3].map((n) => (
              <div key={n} className="h-14 bg-slate-100 rounded animate-pulse" />
            ))}
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="px-6 py-14 text-center max-w-md mx-auto">
            <UtensilsCrossed className="w-8 h-8 text-slate-300 mx-auto mb-3" />
            <h3 className="text-base font-semibold text-slate-900">
              {items.length === 0 ? 'No menu items yet' : 'No matching items'}
            </h3>
            <p className="mt-1.5 text-sm text-slate-600">
              {items.length === 0
                ? readOnly
                  ? 'The shop owner has not published menu items yet.'
                  : 'Add your first menu item to publish it on your public link and server board.'
                : 'Try another search term, category, or stock status filter.'}
            </p>
            {!readOnly && items.length === 0 ? (
              <button
                type="button"
                onClick={openCreateModal}
                className="mt-5 inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                Add First Item
              </button>
            ) : (
              stockFilter !== 'all' && (
                <button
                  type="button"
                  onClick={() => {
                    setStockFilter('all');
                    setSelectedCategory('All');
                    setSearch('');
                  }}
                  className="mt-4 text-xs font-semibold text-blue-700 hover:underline underline-offset-4 cursor-pointer"
                >
                  Clear active filters
                </button>
              )
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-medium text-slate-500">
                  <th className="py-3 px-5">Item</th>
                  <th className="py-3 px-4">Category</th>
                  <th className="py-3 px-4 text-right">Price</th>
                  <th className="py-3 px-4">Inventory Count</th>
                  <th className="py-3 px-4">Stock Status</th>
                  {!readOnly && <th className="py-3 px-5 text-right">Actions</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-sm">
                {filteredItems.map((item) => {
                  const meta = getMenuStockMeta(item);
                  const isBusy = updatingStockId === item.id;
                  const rowHighlightClass =
                    meta.state === 'out_of_stock'
                      ? 'bg-red-50/50 hover:bg-red-50/80'
                      : meta.state === 'low_stock'
                        ? 'bg-amber-50/60 hover:bg-amber-50/90'
                        : 'hover:bg-slate-50/70';

                  const draftVal =
                    draftStockValues[item.id] !== undefined
                      ? draftStockValues[item.id]
                      : meta.hasCount
                        ? String(item.stock_count)
                        : '';

                  return (
                    <tr key={item.id} className={`transition-colors ${rowHighlightClass}`}>
                      <td className="py-3 px-5">
                        <div className="flex items-center gap-3 min-w-[220px]">
                          <SafeImage
                            src={item.image_url}
                            alt={item.name}
                            fallbackIcon="menu"
                            accentColor={shop.primary_color}
                            className={`w-11 h-11 rounded-md object-cover shrink-0 border border-slate-200 ${
                              meta.state === 'out_of_stock' ? 'opacity-60 grayscale' : ''
                            }`}
                          />
                          <div className="min-w-0">
                            <p
                              className={`font-medium truncate ${
                                meta.state === 'out_of_stock'
                                  ? 'text-slate-600 line-through decoration-red-400/70'
                                  : 'text-slate-900'
                              }`}
                            >
                              {item.name}
                            </p>
                            {item.description && (
                              <p className="text-xs text-slate-500 truncate max-w-xs mt-0.5">
                                {item.description}
                              </p>
                            )}
                          </div>
                        </div>
                      </td>

                      <td className="py-3 px-4 text-xs text-slate-600 whitespace-nowrap">
                        {item.category}
                      </td>

                      <td className="py-3 px-4 text-right font-mono text-sm font-medium text-slate-900 tabular-nums whitespace-nowrap">
                        {formatCurrency(item.price)}
                      </td>

                      {/* Manual Inventory Count Cell */}
                      <td className="py-3 px-4 whitespace-nowrap">
                        {readOnly ? (
                          meta.hasCount ? (
                            <span
                              className={`font-mono text-xs font-semibold tabular-nums ${
                                meta.isZeroStock
                                  ? 'text-red-700'
                                  : meta.state === 'low_stock'
                                    ? 'text-amber-700'
                                    : 'text-slate-700'
                              }`}
                            >
                              {item.stock_count} left
                            </span>
                          ) : (
                            <span className="text-xs text-slate-400">Untracked</span>
                          )
                        ) : meta.hasCount ? (
                          <div className="flex flex-col gap-1">
                            <div className="inline-flex items-center gap-1">
                              <button
                                type="button"
                                disabled={isBusy || (item.stock_count ?? 0) <= 0}
                                onClick={() =>
                                  void handleCommitStock(
                                    item,
                                    Math.max(0, (item.stock_count ?? 0) - 1)
                                  )
                                }
                                aria-label={`Decrease stock for ${item.name}`}
                                className="w-7 h-7 rounded-md border border-slate-300 bg-white flex items-center justify-center text-slate-700 hover:bg-slate-50 disabled:opacity-40 cursor-pointer"
                              >
                                <Minus className="w-3.5 h-3.5" />
                              </button>
                              <input
                                type="number"
                                min={0}
                                max={99999}
                                step={1}
                                disabled={isBusy}
                                aria-label={`Manual stock count for ${item.name}`}
                                value={draftVal}
                                onChange={(e) =>
                                  setDraftStockValues((prev) => ({
                                    ...prev,
                                    [item.id]: e.target.value,
                                  }))
                                }
                                onBlur={() => {
                                  if (draftStockValues[item.id] === undefined) return;
                                  const raw = draftStockValues[item.id].trim();
                                  if (raw === '') {
                                    setDraftStockValues((prev) => {
                                      const copy = { ...prev };
                                      delete copy[item.id];
                                      return copy;
                                    });
                                    return;
                                  }
                                  const parsed = Number(raw);
                                  if (Number.isFinite(parsed) && parsed >= 0) {
                                    void handleCommitStock(item, parsed);
                                  }
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    e.currentTarget.blur();
                                  } else if (e.key === 'Escape') {
                                    setDraftStockValues((prev) => {
                                      const copy = { ...prev };
                                      delete copy[item.id];
                                      return copy;
                                    });
                                    e.currentTarget.blur();
                                  }
                                }}
                                className={`w-16 h-7 px-2 text-center font-mono text-xs font-semibold tabular-nums rounded-md border bg-white focus:outline-none focus:border-blue-600 ${
                                  meta.isZeroStock
                                    ? 'border-red-300 text-red-700'
                                    : meta.state === 'low_stock'
                                      ? 'border-amber-300 text-amber-800'
                                      : 'border-slate-300 text-slate-900'
                                }`}
                              />
                              <button
                                type="button"
                                disabled={isBusy}
                                onClick={() =>
                                  void handleCommitStock(item, (item.stock_count ?? 0) + 1)
                                }
                                aria-label={`Increase stock for ${item.name}`}
                                className="w-7 h-7 rounded-md border border-slate-300 bg-white flex items-center justify-center text-slate-700 hover:bg-slate-50 disabled:opacity-40 cursor-pointer"
                              >
                                <Plus className="w-3.5 h-3.5" />
                              </button>
                            </div>
                            <span className="text-[11px] text-slate-400 font-mono tabular-nums">
                              Alert ≤ {meta.threshold}
                            </span>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-slate-400">Untracked</span>
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => void handleCommitStock(item, 10)}
                              className="text-xs font-medium text-blue-700 hover:underline underline-offset-4 cursor-pointer"
                            >
                              Track
                            </button>
                          </div>
                        )}
                      </td>

                      {/* Stock Status Cell (Zero static pills — crisp semantic typography) */}
                      <td className="py-3 px-4 whitespace-nowrap">
                        {meta.state === 'out_of_stock' ? (
                          <div className="flex flex-col items-start gap-0.5">
                            <span className="text-xs font-semibold text-red-700">
                              Out of stock
                            </span>
                            {!readOnly && (
                              <button
                                type="button"
                                disabled={isBusy}
                                onClick={() => void handleToggleAvailable(item)}
                                className="text-[11px] font-medium text-slate-600 hover:text-slate-900 underline-offset-4 hover:underline cursor-pointer"
                              >
                                {meta.isZeroStock ? 'Quick restock' : 'Mark available'}
                              </button>
                            )}
                          </div>
                        ) : meta.state === 'low_stock' ? (
                          <div className="flex flex-col items-start gap-0.5">
                            <span className="text-xs font-semibold text-amber-700 font-mono tabular-nums">
                              Low stock · {item.stock_count} left
                            </span>
                            {!readOnly && (
                              <button
                                type="button"
                                disabled={isBusy}
                                onClick={() => void handleToggleAvailable(item)}
                                className="text-[11px] font-medium text-slate-500 hover:text-red-700 underline-offset-4 hover:underline cursor-pointer"
                              >
                                Mark out of stock
                              </button>
                            )}
                          </div>
                        ) : readOnly ? (
                          <span className="text-xs font-medium text-emerald-700">Available</span>
                        ) : (
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => void handleToggleAvailable(item)}
                            className="text-xs font-medium text-emerald-700 underline-offset-4 hover:underline cursor-pointer"
                          >
                            Available
                          </button>
                        )}
                      </td>

                      {!readOnly && (
                        <td className="py-3 px-5 text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => openEditModal(item)}
                              aria-label={`Edit ${item.name}`}
                              className="p-2 text-slate-500 hover:text-slate-900 hover:bg-white/80 rounded-md transition-colors cursor-pointer"
                            >
                              <Edit2 className="w-4 h-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleDelete(item)}
                              aria-label={`Delete ${item.name}`}
                              className="p-2 text-slate-500 hover:text-red-700 hover:bg-red-100/70 rounded-md transition-colors cursor-pointer"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Add / Edit Item Modal (Owner Only) */}
      {!readOnly && modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="fixed inset-0 bg-slate-950/40 backdrop-blur-[1px]"
            onClick={() => setModalOpen(false)}
          />
          <div className="relative z-10 w-full max-w-md bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden max-h-[92vh] flex flex-col">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between shrink-0">
              <h3 className="font-display text-base font-semibold text-slate-900">
                {editingItem ? 'Edit Menu Item' : 'New Menu Item'}
              </h3>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="p-1.5 text-slate-400 hover:text-slate-700 rounded-md cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form
              onSubmit={(e) => void handleSave(e)}
              className="p-6 space-y-4 overflow-y-auto"
            >
              {errorMsg && (
                <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
                  {errorMsg}
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Item Name</label>
                <input
                  type="text"
                  required
                  maxLength={100}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Filter Kaapi or Paneer Tikka Melt"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:border-blue-600 focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Category</label>
                  <input
                    type="text"
                    required
                    maxLength={60}
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    placeholder="Chai & Coffee"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:border-blue-600 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Price (INR ₹)
                  </label>
                  <input
                    type="number"
                    required
                    min="0"
                    max="100000"
                    step="0.01"
                    value={price}
                    onChange={(e) => setPrice(e.target.value)}
                    placeholder="220.00"
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg focus:border-blue-600 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Description
                </label>
                <textarea
                  rows={2}
                  maxLength={400}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Tasting notes, ingredients, or preparation details."
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:border-blue-600 focus:outline-none resize-none"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Photo URL (Optional)
                </label>
                <input
                  type="text"
                  maxLength={500}
                  value={imageUrl}
                  onChange={(e) => setImageUrl(e.target.value)}
                  placeholder="https://example.com/item.jpg"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:border-blue-600 focus:outline-none"
                />
              </div>

              {/* Manual Inventory Tracking Section */}
              <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-lg space-y-3">
                <label className="flex items-center gap-2.5 text-sm font-medium text-slate-800 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={trackInventory}
                    onChange={(e) => setTrackInventory(e.target.checked)}
                    className="h-4 w-4 rounded border-slate-300"
                  />
                  <PackageCheck className="w-4 h-4 text-slate-500" />
                  Track manual inventory count
                </label>

                {trackInventory && (
                  <div className="space-y-2.5 pt-1">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-medium text-slate-700 mb-1">
                          Current Stock Count
                        </label>
                        <input
                          type="number"
                          min="0"
                          max="99999"
                          step="1"
                          required
                          value={stockCountInput}
                          onChange={(e) => setStockCountInput(e.target.value)}
                          className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-300 rounded-lg focus:border-blue-600 focus:outline-none tabular-nums"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-slate-700 mb-1">
                          Low Stock Alert At
                        </label>
                        <input
                          type="number"
                          min="1"
                          max="9999"
                          step="1"
                          required
                          value={lowStockThresholdInput}
                          onChange={(e) => setLowStockThresholdInput(e.target.value)}
                          className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-300 rounded-lg focus:border-blue-600 focus:outline-none tabular-nums"
                        />
                      </div>
                    </div>

                    {modalWillBeZero ? (
                      <p className="text-xs font-medium text-red-700">
                        Stock is 0 — saving will automatically mark this item Out of Stock on your
                        storefront.
                      </p>
                    ) : modalWillBeLow ? (
                      <p className="text-xs font-medium text-amber-700">
                        At or below alert threshold — this item will be highlighted as Low Stock.
                      </p>
                    ) : (
                      <p className="text-xs text-slate-500">
                        Item will highlight as Low Stock at {modalParsedThreshold} or fewer units
                        and auto-mark Out of Stock at 0.
                      </p>
                    )}
                  </div>
                )}
              </div>

              <label
                className={`flex items-center gap-2.5 text-sm pt-1 ${
                  modalWillBeZero ? 'text-slate-400 cursor-not-allowed' : 'text-slate-700 cursor-pointer'
                }`}
              >
                <input
                  type="checkbox"
                  disabled={modalWillBeZero}
                  checked={modalWillBeZero ? false : isAvailable}
                  onChange={(e) => setIsAvailable(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300"
                />
                <span>
                  Available for immediate ordering
                  {modalWillBeZero ? ' (disabled at 0 stock)' : ''}
                </span>
              </label>

              <div className="pt-3 border-t border-slate-200 flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 text-xs font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 disabled:opacity-60 cursor-pointer"
                >
                  {saving ? 'Saving...' : editingItem ? 'Save Changes' : 'Add Item'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
