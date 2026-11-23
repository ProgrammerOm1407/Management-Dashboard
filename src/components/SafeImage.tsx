import React, { useEffect, useState } from 'react';
import { Store, UtensilsCrossed, BedDouble } from 'lucide-react';
import { isSafeMediaUrl } from '../lib/validation';
import {
  DEFAULT_DISH_IMAGE,
  DEFAULT_HERO_IMAGE,
  DEFAULT_SUITE_IMAGE,
  DISH_IMAGE_AVOCADO_TARTINE,
  DISH_IMAGE_CARDAMOM_BUN,
  DISH_IMAGE_FILTER_KAAPI,
  DISH_IMAGE_KOKUM_COOLER,
  DISH_IMAGE_MASALA_CHAI,
  DISH_IMAGE_PANEER_MELT,
} from '../types';
import heroAsset from '../assets/images/hospitality_cafe_hero_1795324939063.jpg';
import dishAsset from '../assets/images/culinary_dish_plate_1795324938671.jpg';
import suiteAsset from '../assets/images/boutique_hotel_suite_1795324939826.jpg';
import cardamomBunAsset from '../assets/images/dish_cardamom_bun_1795429568926.jpg';
import masalaChaiAsset from '../assets/images/dish_masala_chai_1795429568425.jpg';
import filterKaapiAsset from '../assets/images/dish_filter_kaapi_1795429567787.jpg';
import kokumCoolerAsset from '../assets/images/dish_kokum_cooler_1795429567226.jpg';
import avocadoTartineAsset from '../assets/images/dish_avocado_tartine_1795429568855.jpg';
import paneerMeltAsset from '../assets/images/dish_paneer_melt_1795429567948.jpg';

const BUNDLED_LOCAL_ASSETS: Record<string, string> = {
  [DEFAULT_HERO_IMAGE]: heroAsset,
  [DEFAULT_DISH_IMAGE]: dishAsset,
  [DEFAULT_SUITE_IMAGE]: suiteAsset,
  [DISH_IMAGE_CARDAMOM_BUN]: cardamomBunAsset,
  [DISH_IMAGE_MASALA_CHAI]: masalaChaiAsset,
  [DISH_IMAGE_FILTER_KAAPI]: filterKaapiAsset,
  [DISH_IMAGE_KOKUM_COOLER]: kokumCoolerAsset,
  [DISH_IMAGE_AVOCADO_TARTINE]: avocadoTartineAsset,
  [DISH_IMAGE_PANEER_MELT]: paneerMeltAsset,
};

const SIGNATURE_DISH_IMAGE_MATCHERS: { test: RegExp; src: string }[] = [
  { test: /cardamom|jaggery\s*bun|brioche/i, src: DISH_IMAGE_CARDAMOM_BUN },
  { test: /masala\s*chai|adrak|elaichi\s*chai|\bchai\b/i, src: DISH_IMAGE_MASALA_CHAI },
  { test: /filter\s*kaapi|chikmagalur|\bkaapi\b|filter\s*coffee/i, src: DISH_IMAGE_FILTER_KAAPI },
  { test: /kokum|yuzu|cooler/i, src: DISH_IMAGE_KOKUM_COOLER },
  { test: /avocado|gunpowder|tartine/i, src: DISH_IMAGE_AVOCADO_TARTINE },
  { test: /paneer\s*tikka|sourdough\s*melt|paneer/i, src: DISH_IMAGE_PANEER_MELT },
];

export function resolveDishImage(dishName: string, currentUrl?: string | null): string {
  const trimmed = (currentUrl || '').trim();
  const isCustomImage = trimmed.length > 0 && trimmed !== DEFAULT_DISH_IMAGE;
  if (isCustomImage) {
    return trimmed;
  }
  for (const matcher of SIGNATURE_DISH_IMAGE_MATCHERS) {
    if (matcher.test.test(dishName)) {
      return matcher.src;
    }
  }
  return trimmed;
}

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
        className={`flex flex-col items-center justify-center bg-stone-100 text-stone-500 select-none ${className}`}
        style={{
          backgroundImage: `radial-gradient(circle at 25% 20%, ${accentColor}1a, transparent 62%)`,
        }}
        role="img"
        aria-label={alt}
      >
        <div
          className="w-10 h-10 rounded-xl bg-white/85 border border-stone-200/80 flex items-center justify-center shadow-2xs"
          style={{ color: accentColor }}
        >
          <Icon className="w-4 h-4" />
        </div>
        {fallbackLabel && (
          <span className="mt-2 text-xs font-medium text-stone-600 px-3 text-center truncate max-w-full">
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
