import React, { useEffect, useState } from 'react';
import { Store, UtensilsCrossed, BedDouble } from 'lucide-react';
import { isSafeMediaUrl } from '../lib/validation';
import { DEFAULT_DISH_IMAGE, DEFAULT_HERO_IMAGE, DEFAULT_SUITE_IMAGE } from '../types';
import heroAsset from '../assets/images/hospitality_cafe_hero_1795324939063.jpg';
import dishAsset from '../assets/images/culinary_dish_plate_1795324938671.jpg';
import suiteAsset from '../assets/images/boutique_hotel_suite_1795324939826.jpg';

const BUNDLED_LOCAL_ASSETS: Record<string, string> = {
  [DEFAULT_HERO_IMAGE]: heroAsset,
  [DEFAULT_DISH_IMAGE]: dishAsset,
  [DEFAULT_SUITE_IMAGE]: suiteAsset,
};

const BASE_PREFIX = import.meta.env.BASE_URL.replace(/\/+$/, '');

function resolveAssetUrl(url: string): string {
  if (BUNDLED_LOCAL_ASSETS[url]) {
    return BUNDLED_LOCAL_ASSETS[url];
  }
  if (url.startsWith('/') && !url.startsWith('//')) {
    return `${BASE_PREFIX}${url}`;
  }
  return url;
}

interface SafeImageProps {
  src?: string;
  alt: string;
  className?: string;
  fallbackIcon?: 'shop' | 'menu' | 'room';
  fallbackLabel?: string;
  accentColor?: string;
}

export const SafeImage: React.FC<SafeImageProps> = ({
  src,
  alt,
  className = '',
  fallbackIcon = 'shop',
  fallbackLabel,
  accentColor = '#0F172A',
}) => {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [src]);

  const trimmed = src ? src.trim() : '';
  const validSrc = trimmed && isSafeMediaUrl(trimmed) ? resolveAssetUrl(trimmed) : '';

  if (!validSrc || failed) {
    const Icon =
      fallbackIcon === 'menu'
        ? UtensilsCrossed
        : fallbackIcon === 'room'
          ? BedDouble
          : Store;

    return (
      <div
        className={`flex flex-col items-center justify-center bg-slate-100 text-slate-500 select-none ${className}`}
        style={{
          backgroundImage: `radial-gradient(circle at 20% 20%, ${accentColor}14, transparent 60%)`,
        }}
        role="img"
        aria-label={alt}
      >
        <Icon className="w-5 h-5 text-slate-400" />
        {fallbackLabel && (
          <span className="mt-1.5 text-xs font-medium text-slate-500 px-2 text-center truncate max-w-full">
            {fallbackLabel}
          </span>
        )}
      </div>
    );
  }

  return (
    <img
      src={validSrc}
      alt={alt}
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className={className}
    />
  );
};
