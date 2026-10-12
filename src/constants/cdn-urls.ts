// Pinned runtime dependency versions and same-origin asset URLs

export const PINNED_ESBUILD_WASM = '0.28.2';
export const PINNED_ROLLUP_BROWSER = '4.44.0';
export const PINNED_BROTLI_WASM = '3.0.3';
export const PINNED_LIGHTNINGCSS_WASM = '1.31.1';
export const PINNED_WA_SQLITE = '1.0.0';

// fast-esbuild-wasm is all JavaScript: it ships no esbuild.wasm.
const PINNED_FAST_ESBUILD = '0.28.5'; // (initialize({ serviceInWorker, smallInput }) since 0.28.4)
const PINNED_FAST_BROTLI = '3.0.3';
const NODEPOD_ASSET_BASE = "/__nodepod/assets";
const FAST_ESBUILD_BASE = `${NODEPOD_ASSET_BASE}/fast-esbuild-wasm`;
export const ESBUILD_HAS_BINARY = false;

export const CDN_ESBUILD_ESM = `${FAST_ESBUILD_BASE}/esm/browser.min.js`;
// Never fetched: initialize() only checks that it is a URL, there is no binary.
export const CDN_ESBUILD_BINARY = `${FAST_ESBUILD_BASE}/esbuild.wasm`;
// The module CDN_ESBUILD_ESM re-exports. Importing it under a distinct query
// yields a separate module instance, i.e. a separate esbuild service (see
// esbuild-engine.ts recycling).
export const CDN_ESBUILD_BUNDLE = `${FAST_ESBUILD_BASE}/esm/browser.min.js`;
// esbuild's browser build as a classic script, evaluated once per instance
// (see esbuild-engine.ts)
export const CDN_ESBUILD_BROWSER_SCRIPT = `${FAST_ESBUILD_BASE}/lib/browser.min.js`;
export const CDN_ROLLUP_BROWSER = `${NODEPOD_ASSET_BASE}/rollup-browser/dist/es/rollup.browser.js`;
// The browser build keeps its WASM glue next to the copied binary asset.
export const CDN_BROTLI_WASM = `${NODEPOD_ASSET_BASE}/fast-brotli-wasm/pkg.web.mjs`;
export const CDN_LIGHTNINGCSS_WASM = `${NODEPOD_ASSET_BASE}/lightningcss-wasm/index.mjs`;
export const CDN_WA_SQLITE = `${NODEPOD_ASSET_BASE}/wa-sqlite/dist/wa-sqlite.mjs`;
export const CDN_WA_SQLITE_WASM = `${NODEPOD_ASSET_BASE}/wa-sqlite/dist/wa-sqlite.wasm`;

export function cdnImport(url: string): Promise<any> {
  const isBrowserRealm =
    typeof location !== "undefined" &&
    (location.protocol === "https:" || location.protocol === "http:");
  if (!isBrowserRealm && url.startsWith(`${NODEPOD_ASSET_BASE}/`)) {
    const serverPackages: Record<string, string> = {
      [`${FAST_ESBUILD_BASE}/esm/browser.min.js`]: "@r1ck404/fast-esbuild-wasm/esm/browser.min.js",
      [`${FAST_ESBUILD_BASE}/lib/browser.min.js`]: "@r1ck404/fast-esbuild-wasm/lib/browser.min.js",
      [`${NODEPOD_ASSET_BASE}/rollup-browser/dist/es/rollup.browser.js`]: "@rollup/browser",
      [`${NODEPOD_ASSET_BASE}/fast-brotli-wasm/pkg.web.mjs`]: "brotli-wasm",
      [`${NODEPOD_ASSET_BASE}/lightningcss-wasm/index.mjs`]: "lightningcss-wasm",
      [`${NODEPOD_ASSET_BASE}/wa-sqlite/dist/wa-sqlite.mjs`]: "wa-sqlite/dist/wa-sqlite.mjs",
    };
    const packageUrl = serverPackages[url];
    if (packageUrl) return import(packageUrl);
  }
  return import(/* @vite-ignore */ url);
}
