import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Check, Copy, ExternalLink, Smartphone } from 'lucide-react';
import { buildUpiPaymentUri } from '../lib/upi';
import { formatCurrency } from '../lib/validation';

interface UpiPaymentBoxProps {
  upiId: string;
  payeeName: string;
  amount: number;
  orderRef: string;
  utrNumber: string;
  onUtrChange: (value: string) => void;
  accentColor?: string;
}

export const UpiPaymentBox: React.FC<UpiPaymentBoxProps> = ({
  upiId,
  payeeName,
  amount,
  orderRef,
  utrNumber,
  onUtrChange,
  accentColor = '#0F172A',
}) => {
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [copiedId, setCopiedId] = useState(false);

  const upiUri = buildUpiPaymentUri({
    upiId,
    payeeName,
    amount,
    orderRef,
  });

  useEffect(() => {
    let active = true;
    void QRCode.toDataURL(upiUri, {
      width: 240,
      margin: 2,
      errorCorrectionLevel: 'M',
      color: {
        dark: '#0F172A',
        light: '#FFFFFF',
      },
    })
      .then((url) => {
        if (active) setQrDataUrl(url);
      })
      .catch(() => {
        if (active) setQrDataUrl('');
      });
    return () => {
      active = false;
    };
  }, [upiUri]);

  const handleCopyUpiId = async () => {
    try {
      await navigator.clipboard.writeText(upiId);
      setCopiedId(true);
      window.setTimeout(() => setCopiedId(false), 1800);
    } catch {
      // Clipboard unavailable in restricted context
    }
  };

  return (
    <div className="border border-slate-200 rounded-lg bg-slate-50/70 p-4 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold text-slate-900">Scan & Pay via UPI</p>
          <p className="text-[11px] text-slate-500 mt-0.5">
            GPay, PhonePe, Paytm, BHIM, or any NPCI UPI app
          </p>
        </div>
        <span className="font-mono text-sm font-bold text-slate-900 tabular-nums shrink-0">
          {formatCurrency(amount)}
        </span>
      </div>

      {/* Dynamic NPCI UPI QR Code */}
      <div className="bg-white border border-slate-200 rounded-lg p-4 flex flex-col items-center text-center">
        {qrDataUrl ? (
          <img
            src={qrDataUrl}
            alt={`UPI QR code to pay ${formatCurrency(amount)} to ${payeeName}`}
            className="w-44 h-44 object-contain"
          />
        ) : (
          <div className="w-44 h-44 bg-slate-100 rounded animate-pulse" />
        )}
        <p className="mt-2.5 text-xs font-semibold text-slate-900">{payeeName}</p>
        <div className="mt-1 flex items-center justify-center gap-1.5">
          <span className="font-mono text-[11px] text-slate-600">{upiId}</span>
          <button
            type="button"
            onClick={() => void handleCopyUpiId()}
            aria-label="Copy UPI ID"
            className="p-1 text-slate-400 hover:text-slate-700 rounded cursor-pointer"
          >
            {copiedId ? (
              <Check className="w-3 h-3 text-emerald-600" />
            ) : (
              <Copy className="w-3 h-3" />
            )}
          </button>
        </div>
        <p className="mt-1 font-mono text-[11px] text-slate-400 tabular-nums">
          Ref: Order-{orderRef}
        </p>
      </div>

      {/* Mobile Direct UPI App Deep Link */}
      <a
        href={upiUri}
        className="md:hidden w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-semibold text-white rounded-lg hover:opacity-95 transition-opacity"
        style={{ backgroundColor: accentColor }}
      >
        <Smartphone className="w-4 h-4" />
        Pay with UPI App
        <ExternalLink className="w-3.5 h-3.5" />
      </a>

      {/* Optional UTR / Transaction Reference Number */}
      <div>
        <label className="block text-xs font-medium text-slate-700 mb-1">
          UTR / Transaction Reference Number (Optional)
        </label>
        <input
          type="text"
          maxLength={64}
          value={utrNumber}
          onChange={(e) => onUtrChange(e.target.value)}
          placeholder="e.g. 432619847512"
          className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-300 rounded-lg focus:border-blue-600 focus:outline-none tabular-nums"
        />
        <p className="mt-1 text-[11px] text-slate-500">
          After completing payment in your UPI app, tap <strong>I Have Paid</strong> below so staff
          can verify your transfer.
        </p>
      </div>
    </div>
  );
};
