import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import {
  Banknote,
  Check,
  Copy,
  ExternalLink,
  QrCode,
  Save,
  Smartphone,
  Wallet,
} from 'lucide-react';
import { Shop } from '../../types';
import { updateShopBranding, updateShopPaymentSettings } from '../../lib/firestoreService';
import { buildUpiPaymentUri, isValidUpiId } from '../../lib/upi';
import { SafeImage } from '../SafeImage';
import { useToast } from '../../context/ToastContext';

interface ShopSettingsPanelProps {
  shop: Shop;
  onOpenStorefront: () => void;
  onOpenQrCode: () => void;
}

const PRESET_COLORS = ['#2563EB', '#0F766E', '#B45309', '#9F1239', '#4338CA', '#0F172A'];

export const ShopSettingsPanel: React.FC<ShopSettingsPanelProps> = ({
  shop,
  onOpenStorefront,
  onOpenQrCode,
}) => {
  const { pushToast } = useToast();

  // Branding state
  const [name, setName] = useState(shop.name);
  const [logoUrl, setLogoUrl] = useState(shop.logo_url);
  const [primaryColor, setPrimaryColor] = useState(shop.primary_color);
  const [description, setDescription] = useState(shop.description);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Payment settings state
  const [acceptCash, setAcceptCash] = useState(shop.accept_cash !== false);
  const [acceptUpi, setAcceptUpi] = useState(Boolean(shop.accept_upi));
  const [upiId, setUpiId] = useState(shop.upi_id || '');
  const [upiPayeeName, setUpiPayeeName] = useState(shop.upi_payee_name || shop.name);
  const [savingPayments, setSavingPayments] = useState(false);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [previewQr, setPreviewQr] = useState('');

  useEffect(() => {
    setName(shop.name);
    setLogoUrl(shop.logo_url);
    setPrimaryColor(shop.primary_color);
    setDescription(shop.description);
    setAcceptCash(shop.accept_cash !== false);
    setAcceptUpi(Boolean(shop.accept_upi));
    setUpiId(shop.upi_id || '');
    setUpiPayeeName(shop.upi_payee_name || shop.name);
  }, [
    shop.id,
    shop.name,
    shop.logo_url,
    shop.primary_color,
    shop.description,
    shop.accept_cash,
    shop.accept_upi,
    shop.upi_id,
    shop.upi_payee_name,
  ]);

  const validPreviewUpi = isValidUpiId(upiId);

  useEffect(() => {
    if (!validPreviewUpi) {
      setPreviewQr('');
      return;
    }
    let active = true;
    const sampleUri = buildUpiPaymentUri({
      upiId: upiId.trim(),
      payeeName: upiPayeeName.trim() || shop.name,
      amount: 100,
      orderRef: 'SAMPLE',
    });
    void QRCode.toDataURL(sampleUri, {
      width: 160,
      margin: 2,
      errorCorrectionLevel: 'M',
    })
      .then((url) => {
        if (active) setPreviewQr(url);
      })
      .catch(() => {
        if (active) setPreviewQr('');
      });
    return () => {
      active = false;
    };
  }, [validPreviewUpi, upiId, upiPayeeName, shop.name]);

  const publicUrl = `${window.location.origin}/s/${shop.slug}`;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSaving(true);
    try {
      await updateShopBranding(shop, {
        name,
        logo_url: logoUrl,
        primary_color: primaryColor,
        description,
      });
      pushToast('Shop settings saved', 'Branding and storefront details updated.', 'success');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to save branding.');
    } finally {
      setSaving(false);
    }
  };

  const handleSavePayments = async (e: React.FormEvent) => {
    e.preventDefault();
    setPaymentError(null);
    setSavingPayments(true);
    try {
      await updateShopPaymentSettings(shop, {
        accept_cash: acceptCash,
        accept_upi: acceptUpi,
        upi_id: upiId,
        upi_payee_name: upiPayeeName,
      });
      pushToast(
        'Payment settings updated',
        acceptUpi
          ? `Dynamic UPI QR active for ${upiId.trim()}.`
          : 'Cash checkout settings saved.',
        'success'
      );
    } catch (err) {
      setPaymentError(err instanceof Error ? err.message : 'Unable to save payment settings.');
    } finally {
      setSavingPayments(false);
    }
  };

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(publicUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      pushToast('Copy unavailable', publicUrl, 'info');
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display text-lg font-semibold text-slate-900">Shop Settings</h2>
        <p className="text-xs text-slate-500 mt-0.5">
          Customize branding, guest-facing storefront appearance, and accepted Cash & UPI payment
          methods.
        </p>
      </div>

      <div className="grid lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: Branding + Payment Settings */}
        <div className="lg:col-span-7 space-y-6">
          {/* Payment Settings Card */}
          <form
            onSubmit={(e) => void handleSavePayments(e)}
            className="bg-white border border-slate-200 rounded-lg p-6 space-y-5"
          >
            <div className="flex items-start justify-between gap-4 border-b border-slate-100 pb-4">
              <div>
                <div className="flex items-center gap-2">
                  <Wallet className="w-4 h-4 text-slate-700" />
                  <h3 className="font-display text-base font-semibold text-slate-900">
                    Payment Settings
                  </h3>
                </div>
                <p className="text-xs text-slate-500 mt-0.5">
                  Configure Cash and Dynamic NPCI UPI QR checkout for Food Orders and Hotel Room
                  Bookings.
                </p>
              </div>
              <span
                className={`text-xs font-medium whitespace-nowrap ${
                  acceptUpi && validPreviewUpi ? 'text-emerald-700' : 'text-slate-500'
                }`}
              >
                {acceptUpi && validPreviewUpi ? 'UPI Active' : 'Cash Only'}
              </span>
            </div>

            {paymentError && (
              <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
                {paymentError}
              </div>
            )}

            {/* Cash & UPI Toggles */}
            <div className="grid sm:grid-cols-2 gap-3">
              <label className="flex items-start gap-3 p-3.5 rounded-lg border border-slate-200 bg-slate-50/60 hover:bg-slate-50 cursor-pointer">
                <input
                  type="checkbox"
                  checked={acceptCash}
                  onChange={(e) => setAcceptCash(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-slate-300"
                />
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 text-sm font-medium text-slate-900">
                    <Banknote className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                    <span>Accept Cash</span>
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Guests pay Cash at the counter or front desk.
                  </p>
                </div>
              </label>

              <label className="flex items-start gap-3 p-3.5 rounded-lg border border-slate-200 bg-slate-50/60 hover:bg-slate-50 cursor-pointer">
                <input
                  type="checkbox"
                  checked={acceptUpi}
                  onChange={(e) => setAcceptUpi(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-slate-300"
                />
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 text-sm font-medium text-slate-900">
                    <Smartphone className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                    <span>Accept UPI QR</span>
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Generate dynamic amount-locked UPI QR codes.
                  </p>
                </div>
              </label>
            </div>

            {/* Merchant UPI Details */}
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">
                  Merchant UPI ID (VPA)
                </label>
                <input
                  type="text"
                  maxLength={128}
                  required={acceptUpi}
                  value={upiId}
                  onChange={(e) => setUpiId(e.target.value)}
                  placeholder="mycafe@okicici"
                  className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg focus:border-blue-600 focus:outline-none"
                />
                <p className="text-[11px] text-slate-500 mt-1">
                  Your business VPA (e.g. <span className="font-mono">shopname@okaxis</span> or{' '}
                  <span className="font-mono">9876543210@ybl</span>)
                </p>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">
                  Business Payee Name
                </label>
                <input
                  type="text"
                  maxLength={100}
                  value={upiPayeeName}
                  onChange={(e) => setUpiPayeeName(e.target.value)}
                  placeholder={shop.name}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:border-blue-600 focus:outline-none"
                />
                <p className="text-[11px] text-slate-500 mt-1">
                  Displayed inside GPay, PhonePe, and Paytm during checkout.
                </p>
              </div>
            </div>

            {/* Compact Live UPI QR Verification Preview */}
            {validPreviewUpi && previewQr && (
              <div className="p-3.5 rounded-lg border border-slate-200 bg-slate-50/70 flex flex-col sm:flex-row items-center gap-4">
                <img
                  src={previewQr}
                  alt="Sample UPI QR code preview"
                  className="w-24 h-24 rounded-md bg-white border border-slate-200 p-1.5 shrink-0"
                />
                <div className="space-y-1 text-center sm:text-left min-w-0">
                  <p className="text-xs font-semibold text-slate-900">
                    Dynamic NPCI UPI QR Preview (₹100.00 sample)
                  </p>
                  <p className="text-xs text-slate-600 font-mono truncate">
                    {upiId.trim()} · {upiPayeeName.trim() || shop.name}
                  </p>
                  <p className="text-[11px] text-slate-500">
                    At checkout, each order or room booking automatically locks the exact total
                    amount and order reference inside the QR code.
                  </p>
                </div>
              </div>
            )}

            <div className="pt-1 flex justify-end">
              <button
                type="submit"
                disabled={savingPayments}
                className="inline-flex items-center gap-2 px-5 py-2.5 text-xs font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 disabled:opacity-60 cursor-pointer"
              >
                <Save className="w-4 h-4" />
                {savingPayments ? 'Saving...' : 'Save Payment Settings'}
              </button>
            </div>
          </form>

          {/* Branding Form Card */}
          <form
            onSubmit={(e) => void handleSave(e)}
            className="bg-white border border-slate-200 rounded-lg p-6 space-y-5"
          >
            <div className="border-b border-slate-100 pb-4">
              <h3 className="font-display text-base font-semibold text-slate-900">
                Storefront Branding
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Controls your venue header, brand color, and guest-facing storefront description.
              </p>
            </div>

            {errorMsg && (
              <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
                {errorMsg}
              </div>
            )}

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5">
                Business Name
              </label>
              <input
                type="text"
                required
                maxLength={100}
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:border-blue-600 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5">
                Logo URL (https://)
              </label>
              <input
                type="text"
                maxLength={500}
                value={logoUrl}
                onChange={(e) => setLogoUrl(e.target.value)}
                placeholder="https://example.com/your-logo.png"
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:border-blue-600 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5">
                Primary Brand Color
              </label>
              <div className="flex flex-wrap items-center gap-3">
                <input
                  type="color"
                  value={primaryColor}
                  onChange={(e) => setPrimaryColor(e.target.value)}
                  className="w-10 h-10 rounded border border-slate-300 p-0.5 bg-white cursor-pointer"
                />
                <input
                  type="text"
                  maxLength={7}
                  value={primaryColor}
                  onChange={(e) => setPrimaryColor(e.target.value)}
                  className="w-28 px-3 py-2 text-xs font-mono border border-slate-300 rounded-lg focus:border-blue-600 focus:outline-none"
                />
                <div className="flex items-center gap-2">
                  {PRESET_COLORS.map((hex) => (
                    <button
                      key={hex}
                      type="button"
                      onClick={() => setPrimaryColor(hex)}
                      aria-label={`Use ${hex}`}
                      className={`w-6 h-6 rounded-md cursor-pointer ${
                        primaryColor.toLowerCase() === hex.toLowerCase()
                          ? 'ring-2 ring-offset-2 ring-slate-900'
                          : ''
                      }`}
                      style={{ backgroundColor: hex }}
                    />
                  ))}
                </div>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5">
                Storefront Description
              </label>
              <textarea
                rows={3}
                maxLength={400}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Tell guests about your cafe, restaurant, or hotel."
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:border-blue-600 focus:outline-none resize-none"
              />
            </div>

            <div className="pt-2 flex justify-end">
              <button
                type="submit"
                disabled={saving}
                className="inline-flex items-center gap-2 px-5 py-2.5 text-xs font-semibold text-white rounded-lg hover:opacity-95 disabled:opacity-60 cursor-pointer"
                style={{ backgroundColor: primaryColor || '#0F172A' }}
              >
                <Save className="w-4 h-4" />
                {saving ? 'Saving...' : 'Save Branding'}
              </button>
            </div>
          </form>
        </div>

        {/* Live Brand Preview & Public Link */}
        <div className="lg:col-span-5 space-y-5">
          <div className="bg-white border border-slate-200 rounded-lg p-6 space-y-4">
            <p className="text-xs font-medium text-slate-500">Live Brand Header Preview</p>
            <div className="border border-slate-200 rounded-lg overflow-hidden">
              <div className="h-2 w-full" style={{ backgroundColor: primaryColor }} />
              <div className="p-4 flex items-center gap-3.5">
                {logoUrl ? (
                  <SafeImage
                    src={logoUrl}
                    alt={name}
                    accentColor={primaryColor}
                    className="w-11 h-11 rounded-lg object-cover border border-slate-200 shrink-0"
                  />
                ) : (
                  <div
                    className="w-11 h-11 rounded-lg flex items-center justify-center text-white font-display font-bold text-lg shrink-0"
                    style={{ backgroundColor: primaryColor }}
                  >
                    {(name || 'S').slice(0, 1).toUpperCase()}
                  </div>
                )}
                <div className="min-w-0">
                  <p className="font-display font-semibold text-slate-900 truncate">
                    {name || 'Shop Name'}
                  </p>
                  <p className="text-xs text-slate-500 truncate mt-0.5">
                    {description || 'Public guest menu and hospitality storefront.'}
                  </p>
                </div>
              </div>
            </div>

            <div className="pt-3 border-t border-slate-200 space-y-2.5">
              <p className="text-xs font-medium text-slate-700">Public Storefront Link</p>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  readOnly
                  value={`/s/${shop.slug}`}
                  className="flex-1 px-3 py-2 text-xs font-mono bg-slate-50 border border-slate-200 rounded-lg text-slate-700"
                />
                <button
                  type="button"
                  onClick={() => void handleCopyLink()}
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 cursor-pointer"
                >
                  {copied ? (
                    <Check className="w-3.5 h-3.5 text-emerald-600" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-4 pt-1">
                <button
                  type="button"
                  onClick={onOpenStorefront}
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-700 hover:underline cursor-pointer"
                >
                  Open public storefront
                  <ExternalLink className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={onOpenQrCode}
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-800 hover:underline cursor-pointer"
                >
                  <QrCode className="w-3.5 h-3.5 text-slate-600" />
                  Download printable QR code
                </button>
              </div>
            </div>

            <div className="pt-3 border-t border-slate-200 space-y-1.5 text-xs text-slate-500">
              <div>
                <span className="font-medium text-slate-700">Enabled Modules: </span>
                {[
                  shop.modules.menu && 'Menu',
                  shop.modules.orders && 'Orders',
                  shop.modules.rooms && 'Rooms',
                ]
                  .filter(Boolean)
                  .join(' · ') || 'None'}
              </div>
              <div>
                <span className="font-medium text-slate-700">Accepted Payments: </span>
                {[
                  shop.accept_cash !== false && 'Cash',
                  shop.accept_upi && shop.upi_id && `UPI (${shop.upi_id})`,
                ]
                  .filter(Boolean)
                  .join(' · ') || 'None configured'}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
