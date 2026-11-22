import React, { useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import {
  Check,
  Copy,
  Download,
  ExternalLink,
  FileCode2,
  Grid2x2,
  Printer,
  QrCode,
  Square,
} from 'lucide-react';
import { Shop } from '../../types';
import { SafeImage } from '../SafeImage';
import { useToast } from '../../context/ToastContext';
import { getShopTypeLabel, slugify } from '../../lib/validation';

interface QrCodePanelProps {
  shop: Shop;
  onOpenStorefront: () => void;
}

type QrMode = 'single' | 'batch';
type PosterLayout = 'tent' | 'counter' | 'sticker';

interface BatchQrItem {
  num: number;
  label: string;
  queryValue: string;
  url: string;
  displayPath: string;
  dataUrl: string;
}

function formatSingleDisplayLabel(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  return /^\d+$/.test(trimmed) ? `Table ${trimmed}` : trimmed;
}

export const QrCodePanel: React.FC<QrCodePanelProps> = ({ shop, onOpenStorefront }) => {
  const { pushToast } = useToast();
  const [mode, setMode] = useState<QrMode>('single');

  // Single poster state
  const [tableLabel, setTableLabel] = useState('');
  const [headline, setHeadline] = useState('Scan to View Menu & Order');
  const [subtext, setSubtext] = useState(
    'Point your phone camera at the QR code to browse our live menu and place an order.'
  );
  const [layout, setLayout] = useState<PosterLayout>('tent');
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [qrSvg, setQrSvg] = useState<string>('');
  const [generating, setGenerating] = useState(false);
  const [copied, setCopied] = useState(false);

  // Batch table sheet (1-N) state
  const [batchPrefix, setBatchPrefix] = useState('Table');
  const [batchStart, setBatchStart] = useState(1);
  const [batchEnd, setBatchEnd] = useState(10);
  const [batchItems, setBatchItems] = useState<BatchQrItem[]>([]);
  const [batchGenerating, setBatchGenerating] = useState(false);

  const accent = shop.primary_color || '#2563EB';
  const singleDisplayTable = useMemo(() => formatSingleDisplayLabel(tableLabel), [tableLabel]);

  const targetUrl = useMemo(() => {
    const base = `${window.location.origin}/s/${shop.slug}`;
    const trimmedTable = tableLabel.trim();
    if (!trimmedTable) return base;
    return `${base}?table=${encodeURIComponent(trimmedTable)}`;
  }, [shop.slug, tableLabel]);

  const displayPath = useMemo(() => {
    const base = `/s/${shop.slug}`;
    const trimmedTable = tableLabel.trim();
    return trimmedTable ? `${base}?table=${encodeURIComponent(trimmedTable)}` : base;
  }, [shop.slug, tableLabel]);

  // Generate Single QR
  useEffect(() => {
    let cancelled = false;
    setGenerating(true);

    Promise.all([
      QRCode.toDataURL(targetUrl, {
        width: 720,
        margin: 2,
        errorCorrectionLevel: 'H',
        color: {
          dark: '#0F172A',
          light: '#FFFFFF',
        },
      }),
      QRCode.toString(targetUrl, {
        type: 'svg',
        margin: 2,
        errorCorrectionLevel: 'H',
        color: {
          dark: '#0F172A',
          light: '#FFFFFF',
        },
      }),
    ])
      .then(([dataUrl, svgStr]) => {
        if (!cancelled) {
          setQrDataUrl(dataUrl);
          setQrSvg(svgStr);
        }
      })
      .catch((err) => {
        console.error('QR generation failed:', err);
      })
      .finally(() => {
        if (!cancelled) setGenerating(false);
      });

    return () => {
      cancelled = true;
    };
  }, [targetUrl]);

  // Normalized batch bounds (max 30 per printable sheet)
  const batchRange = useMemo(() => {
    const start = Math.max(1, Math.min(999, Math.floor(batchStart || 1)));
    const end = Math.max(start, Math.min(start + 29, Math.floor(batchEnd || start)));
    return { start, end, count: end - start + 1 };
  }, [batchStart, batchEnd]);

  // Generate Batch Table QRs when in batch mode
  useEffect(() => {
    if (mode !== 'batch') return;
    let cancelled = false;
    setBatchGenerating(true);

    const cleanPrefix = batchPrefix.trim() || 'Table';
    const isStandardTable = cleanPrefix.toLowerCase() === 'table';
    const numbers: number[] = [];
    for (let n = batchRange.start; n <= batchRange.end; n++) {
      numbers.push(n);
    }

    Promise.all(
      numbers.map(async (num) => {
        const label = `${cleanPrefix} ${num}`;
        const queryValue = isStandardTable ? String(num) : label;
        const displayPathVal = `/s/${shop.slug}?table=${encodeURIComponent(queryValue)}`;
        const url = `${window.location.origin}${displayPathVal}`;
        const dataUrl = await QRCode.toDataURL(url, {
          width: 480,
          margin: 2,
          errorCorrectionLevel: 'H',
          color: {
            dark: '#0F172A',
            light: '#FFFFFF',
          },
        });
        return {
          num,
          label,
          queryValue,
          url,
          displayPath: displayPathVal,
          dataUrl,
        } satisfies BatchQrItem;
      })
    )
      .then((results) => {
        if (!cancelled) setBatchItems(results);
      })
      .catch((err) => {
        console.error('Batch QR generation failed:', err);
      })
      .finally(() => {
        if (!cancelled) setBatchGenerating(false);
      });

    return () => {
      cancelled = true;
    };
  }, [mode, shop.slug, batchPrefix, batchRange.start, batchRange.end]);

  const fileSuffix = useMemo(() => {
    const t = slugify(singleDisplayTable);
    return t ? `${shop.slug}-${t}` : shop.slug;
  }, [shop.slug, singleDisplayTable]);

  const handleCopyUrl = async () => {
    try {
      await navigator.clipboard.writeText(targetUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      pushToast('Storefront URL', targetUrl, 'info');
    }
  };

  const handleDownloadSvg = () => {
    if (!qrSvg) return;
    const blob = new Blob([qrSvg], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${fileSuffix}-qr.svg`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    pushToast('Vector QR downloaded', `${fileSuffix}-qr.svg saved for print design.`, 'success');
  };

  const exportSinglePosterPng = async (
    imgDataUrl: string,
    posterTableTitle: string,
    posterDisplayPath: string,
    filename: string,
    posterLayout: PosterLayout
  ) => {
    const isSquare = posterLayout === 'sticker';
    const width = 1200;
    const height = isSquare ? 1200 : 1680;

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, width, height);

    ctx.strokeStyle = '#E2E8F0';
    ctx.lineWidth = 4;
    ctx.strokeRect(24, 24, width - 48, height - 48);

    ctx.fillStyle = accent;
    ctx.fillRect(24, 24, width - 48, 28);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    if (isSquare) {
      ctx.fillStyle = '#0F172A';
      ctx.font = '700 46px "Plus Jakarta Sans", system-ui, sans-serif';
      ctx.fillText(shop.name.slice(0, 32), width / 2, 128);

      if (posterTableTitle) {
        ctx.fillStyle = accent;
        ctx.font = '600 28px "DM Sans", system-ui, sans-serif';
        ctx.fillText(posterTableTitle.slice(0, 36), width / 2, 182);
      }

      const qrImg = await loadImage(imgDataUrl);
      const qrSize = 680;
      const qrX = (width - qrSize) / 2;
      const qrY = posterTableTitle ? 225 : 195;
      ctx.drawImage(qrImg, qrX, qrY, qrSize, qrSize);

      ctx.fillStyle = '#0F172A';
      ctx.font = '600 32px "Plus Jakarta Sans", system-ui, sans-serif';
      ctx.fillText((headline || 'Scan for Menu').slice(0, 40), width / 2, qrY + qrSize + 64);

      ctx.fillStyle = '#64748B';
      ctx.font = '500 24px "JetBrains Mono", monospace';
      ctx.fillText(posterDisplayPath.slice(0, 48), width / 2, height - 86);
    } else {
      ctx.fillStyle = '#64748B';
      ctx.font = '500 26px "DM Sans", system-ui, sans-serif';
      ctx.fillText(getShopTypeLabel(shop.type), width / 2, 120);

      ctx.fillStyle = '#0F172A';
      ctx.font = '700 58px "Plus Jakarta Sans", system-ui, sans-serif';
      ctx.fillText(shop.name.slice(0, 28), width / 2, 192);

      if (posterTableTitle) {
        ctx.fillStyle = accent;
        ctx.font = '700 36px "Plus Jakarta Sans", system-ui, sans-serif';
        ctx.fillText(posterTableTitle.slice(0, 32), width / 2, 262);
      }

      const qrSize = posterLayout === 'counter' ? 740 : 680;
      const qrX = (width - qrSize) / 2;
      const qrY = posterTableTitle ? 330 : 295;

      ctx.fillStyle = '#FFFFFF';
      ctx.strokeStyle = '#E2E8F0';
      ctx.lineWidth = 3;
      ctx.fillRect(qrX - 28, qrY - 28, qrSize + 56, qrSize + 56);
      ctx.strokeRect(qrX - 28, qrY - 28, qrSize + 56, qrSize + 56);

      const qrImg = await loadImage(imgDataUrl);
      ctx.drawImage(qrImg, qrX, qrY, qrSize, qrSize);

      const ctaY = qrY + qrSize + 96;
      ctx.fillStyle = '#0F172A';
      ctx.font = '700 40px "Plus Jakarta Sans", system-ui, sans-serif';
      ctx.fillText((headline || 'Scan to View Menu & Order').slice(0, 38), width / 2, ctaY);

      ctx.fillStyle = '#475569';
      ctx.font = '400 26px "DM Sans", system-ui, sans-serif';
      drawWrappedCenteredText(ctx, subtext.trim(), width / 2, ctaY + 62, width - 200, 38);

      ctx.strokeStyle = '#E2E8F0';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(140, height - 170);
      ctx.lineTo(width - 140, height - 170);
      ctx.stroke();

      ctx.fillStyle = '#0F172A';
      ctx.font = '500 26px "JetBrains Mono", monospace';
      ctx.fillText(posterDisplayPath.slice(0, 48), width / 2, height - 110);
    }

    const pngUrl = canvas.toDataURL('image/png');
    const link = document.createElement('a');
    link.href = pngUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleDownloadPosterPng = async () => {
    if (!qrDataUrl) return;
    try {
      const filename = `${fileSuffix}-qr-${layout}.png`;
      await exportSinglePosterPng(qrDataUrl, singleDisplayTable, displayPath, filename, layout);
      pushToast('Printable QR poster downloaded', `Saved high-resolution ${filename}.`, 'success');
    } catch (err) {
      pushToast(
        'Export failed',
        err instanceof Error ? err.message : 'Unable to generate PNG poster.',
        'error'
      );
    }
  };

  const handleDownloadBatchSheetPng = async () => {
    if (batchItems.length === 0) return;
    try {
      const cols = 2;
      const rows = Math.ceil(batchItems.length / cols);
      const pad = 64;
      const gap = 40;
      const cardW = 760;
      const cardH = 920;

      const width = pad * 2 + cols * cardW + (cols - 1) * gap;
      const height = pad * 2 + rows * cardH + (rows - 1) * gap;

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, width, height);

      for (let idx = 0; idx < batchItems.length; idx++) {
        const item = batchItems[idx];
        const col = idx % cols;
        const row = Math.floor(idx / cols);
        const x = pad + col * (cardW + gap);
        const y = pad + row * (cardH + gap);

        // Card border
        ctx.fillStyle = '#FFFFFF';
        ctx.strokeStyle = '#CBD5E1';
        ctx.lineWidth = 3;
        ctx.fillRect(x, y, cardW, cardH);
        ctx.strokeRect(x, y, cardW, cardH);

        // Accent strip
        ctx.fillStyle = accent;
        ctx.fillRect(x, y, cardW, 18);

        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        ctx.fillStyle = '#0F172A';
        ctx.font = '700 36px "Plus Jakarta Sans", system-ui, sans-serif';
        ctx.fillText(shop.name.slice(0, 28), x + cardW / 2, y + 76);

        ctx.fillStyle = accent;
        ctx.font = '700 44px "Plus Jakarta Sans", system-ui, sans-serif';
        ctx.fillText(item.label, x + cardW / 2, y + 138);

        const qrImg = await loadImage(item.dataUrl);
        const qrSize = 500;
        const qrX = x + (cardW - qrSize) / 2;
        const qrY = y + 188;
        ctx.strokeStyle = '#E2E8F0';
        ctx.lineWidth = 2;
        ctx.strokeRect(qrX - 18, qrY - 18, qrSize + 36, qrSize + 36);
        ctx.drawImage(qrImg, qrX, qrY, qrSize, qrSize);

        ctx.fillStyle = '#0F172A';
        ctx.font = '600 28px "Plus Jakarta Sans", system-ui, sans-serif';
        ctx.fillText((headline || 'Scan to View Menu & Order').slice(0, 36), x + cardW / 2, y + 762);

        ctx.fillStyle = '#64748B';
        ctx.font = '500 22px "JetBrains Mono", monospace';
        ctx.fillText(item.displayPath.slice(0, 44), x + cardW / 2, y + 848);
      }

      const filename = `${shop.slug}-tables-${batchRange.start}-to-${batchRange.end}.png`;
      const pngUrl = canvas.toDataURL('image/png');
      const link = document.createElement('a');
      link.href = pngUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      pushToast(
        'Batch table sheet downloaded',
        `Saved ${batchItems.length} QR cards in ${filename}.`,
        'success'
      );
    } catch (err) {
      pushToast(
        'Batch export failed',
        err instanceof Error ? err.message : 'Unable to export batch QR sheet.',
        'error'
      );
    }
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="space-y-6">
      {/* Header & Mode Switch */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 print:hidden">
        <div>
          <h2 className="font-display text-lg font-semibold text-slate-900">
            Printable Storefront QR Studio
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Generate print-ready single posters or batch table sheets (1–N) linking directly to{' '}
            <span className="font-mono text-slate-700">/s/{shop.slug}</span>.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="inline-flex items-center gap-1 p-1 bg-slate-200/70 rounded-lg">
            <button
              type="button"
              onClick={() => setMode('single')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                mode === 'single'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Square className="w-3.5 h-3.5" />
              Single Poster
            </button>
            <button
              type="button"
              onClick={() => setMode('batch')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                mode === 'batch'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Grid2x2 className="w-3.5 h-3.5" />
              Batch Table Sheet (1–N)
            </button>
          </div>

          <button
            type="button"
            onClick={onOpenStorefront}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 whitespace-nowrap cursor-pointer"
          >
            Preview Storefront
            <ExternalLink className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {mode === 'single' ? (
        <div className="grid lg:grid-cols-12 gap-6 items-start">
          {/* Single Poster Controls */}
          <div className="lg:col-span-5 bg-white border border-slate-200 rounded-lg p-6 space-y-5 print:hidden">
            <div>
              <p className="text-xs font-medium text-slate-700 mb-2">Print Format</p>
              <div className="grid grid-cols-3 gap-1 p-1 bg-slate-100 rounded-lg">
                {(
                  [
                    { id: 'tent', label: 'Table Tent' },
                    { id: 'counter', label: 'Counter Stand' },
                    { id: 'sticker', label: 'Square Sticker' },
                  ] as const
                ).map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setLayout(opt.id)}
                    className={`py-1.5 px-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                      layout === opt.id
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5">
                Table or Room Number (Optional)
              </label>
              <input
                type="text"
                maxLength={40}
                value={tableLabel}
                onChange={(e) => setTableLabel(e.target.value)}
                placeholder="e.g. 1, Table 4, Patio 2, or Room 201"
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:border-blue-600 focus:outline-none"
              />
              <p className="mt-1 text-xs text-slate-500">
                Appends <span className="font-mono">?table=...</span> so the guest’s table auto-fills
                when scanned.
              </p>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5">
                Poster Headline
              </label>
              <input
                type="text"
                maxLength={60}
                value={headline}
                onChange={(e) => setHeadline(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:border-blue-600 focus:outline-none"
              />
            </div>

            {layout !== 'sticker' && (
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">
                  Guest Instructions
                </label>
                <textarea
                  rows={2}
                  maxLength={140}
                  value={subtext}
                  onChange={(e) => setSubtext(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:border-blue-600 focus:outline-none resize-none"
                />
              </div>
            )}

            {/* Encoded Destination URL */}
            <div className="pt-4 border-t border-slate-200 space-y-2">
              <p className="text-xs font-medium text-slate-700">Encoded URL</p>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  readOnly
                  value={targetUrl}
                  className="flex-1 px-3 py-2 text-xs font-mono bg-slate-50 border border-slate-200 rounded-lg text-slate-700 truncate"
                />
                <button
                  type="button"
                  onClick={() => void handleCopyUrl()}
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 shrink-0 cursor-pointer"
                >
                  {copied ? (
                    <Check className="w-3.5 h-3.5 text-emerald-600" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
            </div>

            {/* Export Actions */}
            <div className="pt-4 border-t border-slate-200 space-y-2.5">
              <button
                type="button"
                disabled={!qrDataUrl || generating}
                onClick={() => void handleDownloadPosterPng()}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-semibold text-white rounded-lg hover:opacity-95 disabled:opacity-50 transition-opacity cursor-pointer"
                style={{ backgroundColor: accent }}
              >
                <Download className="w-4 h-4" />
                Download Printable Poster (PNG)
              </button>

              <div className="grid grid-cols-2 gap-2.5">
                <button
                  type="button"
                  disabled={!qrSvg || generating}
                  onClick={handleDownloadSvg}
                  className="inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 disabled:opacity-50 cursor-pointer"
                >
                  <FileCode2 className="w-3.5 h-3.5 text-slate-500" />
                  Download SVG
                </button>
                <button
                  type="button"
                  disabled={!qrDataUrl || generating}
                  onClick={handlePrint}
                  className="inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 disabled:opacity-50 cursor-pointer"
                >
                  <Printer className="w-3.5 h-3.5 text-slate-500" />
                  Print Now
                </button>
              </div>
            </div>
          </div>

          {/* Right Live Printable Poster Preview */}
          <div className="lg:col-span-7 flex flex-col items-center justify-center bg-slate-100/80 border border-slate-200 rounded-lg p-6 sm:p-10 print:bg-white print:border-0 print:p-0">
            <div
              className={`print-qr-sheet w-full bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden text-center transition-all duration-150 ${
                layout === 'sticker' ? 'max-w-[360px]' : 'max-w-[420px]'
              }`}
            >
              <div className="h-2.5 w-full" style={{ backgroundColor: accent }} />

              <div className={layout === 'sticker' ? 'p-7 space-y-4' : 'p-8 sm:p-10 space-y-6'}>
                <div className="flex flex-col items-center">
                  {shop.logo_url ? (
                    <SafeImage
                      src={shop.logo_url}
                      alt={`${shop.name} logo`}
                      accentColor={accent}
                      className="w-12 h-12 rounded-lg object-cover border border-slate-200 mb-3"
                    />
                  ) : (
                    <div
                      className="w-11 h-11 rounded-lg flex items-center justify-center text-white font-display font-bold text-lg mb-3"
                      style={{ backgroundColor: accent }}
                    >
                      {shop.name.slice(0, 1).toUpperCase()}
                    </div>
                  )}

                  {layout !== 'sticker' && (
                    <p className="text-xs font-medium text-slate-500">
                      {getShopTypeLabel(shop.type)}
                    </p>
                  )}

                  <h3 className="font-display text-xl sm:text-2xl font-bold text-slate-900 mt-0.5 leading-snug">
                    {shop.name}
                  </h3>

                  {singleDisplayTable && (
                    <p
                      className="mt-1.5 text-sm font-semibold font-display"
                      style={{ color: accent }}
                    >
                      {singleDisplayTable}
                    </p>
                  )}
                </div>

                <div className="mx-auto inline-flex items-center justify-center bg-white border border-slate-200 rounded-lg p-4">
                  {qrDataUrl ? (
                    <img
                      src={qrDataUrl}
                      alt={`QR code for ${shop.name} storefront`}
                      className={layout === 'counter' ? 'w-56 h-56' : 'w-48 h-48'}
                    />
                  ) : (
                    <div className="w-48 h-48 flex flex-col items-center justify-center text-slate-400">
                      <QrCode className="w-8 h-8 mb-2 animate-pulse" />
                      <span className="text-xs">Generating QR...</span>
                    </div>
                  )}
                </div>

                <div className="space-y-1.5">
                  <p className="font-display text-base font-semibold text-slate-900">
                    {headline || 'Scan to View Menu & Order'}
                  </p>
                  {layout !== 'sticker' && subtext.trim() && (
                    <p className="text-xs text-slate-600 leading-relaxed max-w-xs mx-auto">
                      {subtext.trim()}
                    </p>
                  )}
                </div>

                <div className="pt-4 border-t border-slate-200">
                  <p className="font-mono text-xs text-slate-500 truncate">{displayPath}</p>
                </div>
              </div>
            </div>

            <p className="mt-4 text-xs text-slate-500 print:hidden">
              High error-correction QR (Level H) · Optimized for tabletop printouts and matte
              acrylic stands
            </p>
          </div>
        </div>
      ) : (
        /* Batch Table Sheet (1-N) Mode */
        <div className="space-y-6">
          <div className="bg-white border border-slate-200 rounded-lg p-5 print:hidden">
            <div className="grid sm:grid-cols-2 lg:grid-cols-12 gap-4 items-end">
              <div className="lg:col-span-3">
                <label className="block text-xs font-medium text-slate-700 mb-1.5">
                  Label Prefix
                </label>
                <input
                  type="text"
                  maxLength={20}
                  value={batchPrefix}
                  onChange={(e) => setBatchPrefix(e.target.value)}
                  placeholder="Table"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:border-blue-600 focus:outline-none"
                />
              </div>

              <div className="lg:col-span-2">
                <label className="block text-xs font-medium text-slate-700 mb-1.5">Start #</label>
                <input
                  type="number"
                  min={1}
                  max={999}
                  value={batchStart}
                  onChange={(e) => setBatchStart(Number(e.target.value))}
                  className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg focus:border-blue-600 focus:outline-none tabular-nums"
                />
              </div>

              <div className="lg:col-span-2">
                <label className="block text-xs font-medium text-slate-700 mb-1.5">End #</label>
                <input
                  type="number"
                  min={batchRange.start}
                  max={batchRange.start + 29}
                  value={batchEnd}
                  onChange={(e) => setBatchEnd(Number(e.target.value))}
                  className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg focus:border-blue-600 focus:outline-none tabular-nums"
                />
              </div>

              <div className="lg:col-span-5 flex flex-wrap items-center gap-2.5 lg:justify-end">
                <button
                  type="button"
                  disabled={batchGenerating || batchItems.length === 0}
                  onClick={handlePrint}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white rounded-lg hover:opacity-95 disabled:opacity-50 whitespace-nowrap cursor-pointer"
                  style={{ backgroundColor: accent }}
                >
                  <Printer className="w-3.5 h-3.5" />
                  Print Batch Sheet ({batchRange.count})
                </button>
                <button
                  type="button"
                  disabled={batchGenerating || batchItems.length === 0}
                  onClick={() => void handleDownloadBatchSheetPng()}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5 text-slate-500" />
                  Download Sheet PNG
                </button>
              </div>
            </div>

            <p className="mt-3 text-xs text-slate-500">
              Generating {batchRange.count} cards ({batchPrefix.trim() || 'Table'}{' '}
              {batchRange.start}–{batchRange.end}, up to 30 per sheet). Each QR encodes its own{' '}
              <span className="font-mono text-slate-700">
                /s/{shop.slug}?table=
                {(batchPrefix.trim() || 'Table').toLowerCase() === 'table'
                  ? batchRange.start
                  : `${batchPrefix.trim()} ${batchRange.start}`}
              </span>{' '}
              link.
            </p>
          </div>

          {batchGenerating ? (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 print:hidden">
              {[1, 2, 3, 4, 5, 6].map((n) => (
                <div
                  key={n}
                  className="h-72 bg-white border border-slate-200 rounded-lg animate-pulse"
                />
              ))}
            </div>
          ) : (
            <div className="print-qr-grid grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {batchItems.map((item) => (
                <div
                  key={item.num}
                  className="print-qr-card bg-white border border-slate-200 rounded-lg overflow-hidden text-center flex flex-col justify-between"
                >
                  <div className="h-2 w-full" style={{ backgroundColor: accent }} />
                  <div className="p-5 space-y-3">
                    <div>
                      <p className="font-display text-sm font-bold text-slate-900 truncate">
                        {shop.name}
                      </p>
                      <p
                        className="font-display text-base font-bold mt-0.5"
                        style={{ color: accent }}
                      >
                        {item.label}
                      </p>
                    </div>

                    <div className="mx-auto inline-flex items-center justify-center bg-white border border-slate-200 rounded-lg p-2.5">
                      <img
                        src={item.dataUrl}
                        alt={`QR code for ${item.label}`}
                        className="w-36 h-36"
                      />
                    </div>

                    <div>
                      <p className="font-display text-xs font-semibold text-slate-900">
                        {headline || 'Scan to View Menu & Order'}
                      </p>
                      <p className="mt-1 font-mono text-[11px] text-slate-500 truncate">
                        {item.displayPath}
                      </p>
                    </div>
                  </div>

                  <div className="px-4 py-2.5 border-t border-slate-100 bg-slate-50/70 flex items-center justify-between text-xs print:hidden">
                    <span className="font-mono text-[11px] text-slate-500 tabular-nums">
                      #{item.num}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        void exportSinglePosterPng(
                          item.dataUrl,
                          item.label,
                          item.displayPath,
                          `${shop.slug}-${slugify(item.label)}-qr.png`,
                          'tent'
                        ).then(() =>
                          pushToast('Table QR downloaded', `${item.label} PNG saved.`, 'success')
                        )
                      }
                      className="inline-flex items-center gap-1 text-xs font-medium text-slate-700 hover:text-slate-900 cursor-pointer"
                    >
                      <Download className="w-3.5 h-3.5" />
                      PNG
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(e);
    img.src = src;
  });
}

function drawWrappedCenteredText(
  ctx: CanvasRenderingContext2D,
  text: string,
  centerX: number,
  startY: number,
  maxWidth: number,
  lineHeight: number
) {
  const words = text.split(/\s+/);
  let line = '';
  let y = startY;
  let linesDrawn = 0;

  for (let i = 0; i < words.length; i++) {
    const testLine = line ? `${line} ${words[i]}` : words[i];
    const metrics = ctx.measureText(testLine);
    if (metrics.width > maxWidth && line) {
      ctx.fillText(line, centerX, y);
      line = words[i];
      y += lineHeight;
      linesDrawn += 1;
      if (linesDrawn >= 2) break;
    } else {
      line = testLine;
    }
  }
  if (line && linesDrawn < 3) {
    ctx.fillText(line, centerX, y);
  }
}
