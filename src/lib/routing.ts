/**
 * Routing environment helpers for multi-target deployments (local dev, cloud preview,
 * and static hosting such as GitHub Pages).
 */

export function resolveRouterBasename(): string {
  const raw = (import.meta.env.BASE_URL || import.meta.env.VITE_BASE_PATH || '/').trim();
  if (!raw || raw === '/') return '/';
  const withLeading = raw.startsWith('/') ? raw : `/${raw}`;
  const withoutTrailing = withLeading.replace(/\/+$/, '');
  return withoutTrailing || '/';
}

export function isGitHubPagesEnvironment(): boolean {
  const envFlag =
    String(import.meta.env.VITE_GITHUB_PAGES ?? '').toLowerCase() === 'true' ||
    String(import.meta.env.VITE_USE_HASH_ROUTER ?? '').toLowerCase() === 'true';

  if (envFlag) return true;

  if (typeof window !== 'undefined') {
    const hostname = window.location.hostname.toLowerCase();
    if (hostname === 'github.io' || hostname.endsWith('.github.io')) {
      return true;
    }
  }

  return false;
}

/**
 * Builds an absolute shareable URL (e.g. for QR posters or storefront links) that
 * automatically matches the active router mode (HashRouter on GitHub Pages vs BrowserRouter).
 */
export function buildPublicAppUrl(routePath: string): string {
  const normalizedRoute = routePath.startsWith('/') ? routePath : `/${routePath}`;
  const basename = resolveRouterBasename();
  const basePrefix = basename === '/' ? '' : basename;
  const origin = typeof window !== 'undefined' ? window.location.origin : '';

  if (isGitHubPagesEnvironment()) {
    return `${origin}${basePrefix}/#${normalizedRoute}`;
  }

  return `${origin}${basePrefix}${normalizedRoute}`;
}
