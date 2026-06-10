// version.js — single source of truth for the build/version token at runtime.
//
// The cache-busting toolkit (scripts/bust.sh) stamps one token into <meta name="cb">
// and onto every static asset URL as ?v=<token>. Runtime fetch() calls aren't markup,
// so they're fingerprinted here: withV('assets/data/x.json') → '...x.json?v=<token>'.
// This keeps the data layer on the same cache key as the code — one bump busts all.

export const VERSION = '0.1.0';          // human-readable semver (V1 line)

export const BUILD_TOKEN = (() => {
  if (typeof document === 'undefined') return 'dev';
  const m = document.querySelector('meta[name="cb"]');
  return (m && m.getAttribute('content')) || 'dev';
})();

export const withV = (url) => `${url}${url.includes('?') ? '&' : '?'}v=${BUILD_TOKEN}`;
