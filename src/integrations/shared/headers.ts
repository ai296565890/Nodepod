// One place for the headers used when serving __sw__.js, so Vite, Next and
// the generic server handler can't drift apart.

export const DEFAULT_SW_PATH = "/__sw__.js";
export const DEFAULT_BRIDGE_HTML_PATH = "/__nodepod_bridge__.html";
export const DEFAULT_BRIDGE_SCRIPT_PATH = "/__nodepod_bridge__.js";

export const NODEPOD_WORKER_PATHS = [
  "/__worker__.js",
  "/__nodepod/source-worker.js",
  "/__nodepod/engine-worker.js",
  "/__nodepod/wasm-compile-worker.js",
  "/__nodepod/deflate-worker.js",
] as const;

export function workerResponseHeaders(origin: string): Record<string, string> {
  const parsedOrigin = new URL(origin);
  if (parsedOrigin.protocol !== "http:" && parsedOrigin.protocol !== "https:") {
    throw new Error(`Unsupported Worker asset origin: ${parsedOrigin.protocol}`);
  }
  const normalizedOrigin = parsedOrigin.origin;
  return {
    "Content-Type": "application/javascript; charset=utf-8",
    "Cache-Control": "no-cache",
    "Cross-Origin-Resource-Policy": "same-origin",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": [
      "default-src 'none'",
      "script-src 'self' 'unsafe-eval'",
      `worker-src ${workerSrcDirective(normalizedOrigin)}`,
      `connect-src ${normalizedOrigin}/__nodepod/assets/ ${normalizedOrigin}/__nodepod/egress/`,
      "object-src 'none'",
      "base-uri 'none'",
    ].join("; "),
  };
}

export function workerSrcDirective(origin: string): string {
  const parsedOrigin = new URL(origin);
  if (parsedOrigin.protocol !== "http:" && parsedOrigin.protocol !== "https:") {
    throw new Error(`Unsupported Worker source origin: ${parsedOrigin.protocol}`);
  }
  return NODEPOD_WORKER_PATHS
    .map((path) => `${parsedOrigin.origin}${path}`)
    .join(" ");
}

/**
 * Headers for the nodepod service worker response.
 *
 * Content-Type must be a JS type or browsers silently refuse to register
 * the SW (the common failure mode is SPA dev servers serving text/html
 * as a fallback and quietly breaking things).
 *
 * Service-Worker-Allowed: / lets the SW control the whole origin even if
 * the script itself lives under a nested path.
 *
 * Cache-Control: no-cache pairs with the `?v=${Date.now()}` cache-buster
 * the SDK appends on register(), so upgrades don't get a stale SW.
 */
export function swResponseHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/javascript; charset=utf-8",
    "Service-Worker-Allowed": "/",
    "Cache-Control": "no-cache",
  };
}

export function previewBridgeResponseHeaders(
  contentType: string,
  mode?: "top" | "parent" | null,
): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": `${contentType}; charset=utf-8`,
    "Cross-Origin-Resource-Policy": "cross-origin",
    "Cache-Control": "no-store",
  };
  if (mode === "top") {
    headers["Cross-Origin-Opener-Policy"] = "same-origin-allow-popups";
  } else if (mode === "parent") {
    headers["Cross-Origin-Opener-Policy"] = "unsafe-none";
  }
  return headers;
}
