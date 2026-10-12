// Vite plugin that serves /__sw__.js in dev and emits it as an asset at
// build time, so the user never has to copy the file into public/.
//
//   // vite.config.ts
//   import nodepod from '@r1ck404/nodepod/vite';
//   export default defineConfig({ plugins: [nodepod()] });
//
// Vite's types are imported as `type` only so `vite` stays an optional
// peer dep at runtime.

import type { Plugin } from "vite";
import { workerResponseHeaders } from "./shared/headers";
import { handleNodepodEgress } from "./shared/egress-proxy";
import { listNodepodAssets, readNodepodAsset } from "./shared/read-nodepod-assets";
import { readServiceWorkerSource } from "./shared/read-sw";
import { readWorkerBundleSource } from "./shared/read-worker";
import { readPreviewBridgeSource } from "./shared/read-preview-bridge";
import {
  swResponseHeaders,
  previewBridgeResponseHeaders,
  DEFAULT_SW_PATH,
  DEFAULT_BRIDGE_HTML_PATH,
  DEFAULT_BRIDGE_SCRIPT_PATH,
} from "./shared/headers";

const WORKER_ASSET_PATH = "/__worker__.js";
const NODEPOD_ASSET_PREFIX = "/__nodepod/";

function getRequestOrigin(request: {
  headers: Record<string, string | string[] | undefined>;
}): string {
  const host = String(request.headers.host ?? "");
  const parsed = new URL(`http://${host}`);
  const forwarded = request.headers["x-forwarded-proto"];
  const forwardedProtocol = typeof forwarded === "string" ? forwarded : "";
  const protocol =
    forwardedProtocol === "http" || forwardedProtocol === "https"
      ? forwardedProtocol
      : parsed.hostname === "localhost" ||
          parsed.hostname.endsWith(".localhost") ||
          parsed.hostname === "127.0.0.1" ||
          parsed.hostname === "::1" ||
          parsed.hostname === "[::1]"
        ? "http"
        : "https";
  return `${protocol}://${parsed.host}`;
}

export interface NodepodVitePluginOptions {
  /** Path to serve the SW from. Same origin as the page, must end in .js. Defaults to /__sw__.js. */
  path?: string;
  /** Additional HTTPS hosts allowed by the development/preview egress proxy. */
  egressHosts?: string[];
}

export default function nodepod(
  opts: NodepodVitePluginOptions = {},
): Plugin {
  const swPath = opts.path ?? DEFAULT_SW_PATH;
  // Rollup asset names are relative to outDir, so drop the leading slash.
  const assetFileName = swPath.replace(/^\/+/, "");

  return {
    name: "nodepod",
    configureServer(server) {
      // Match on the path alone so the SDK's `?v=${Date.now()}` cache-buster
      // still hits this handler.
      server.middlewares.use(async (req, res, next) => {
        const url = req.url?.split("?")[0];
        if (url?.startsWith(`${NODEPOD_ASSET_PREFIX}egress/`)) {
          await handleNodepodEgress(req, res, opts.egressHosts);
          return;
        }
        if (url?.startsWith(NODEPOD_ASSET_PREFIX)) {
          const relativePath = url.slice(NODEPOD_ASSET_PREFIX.length);
          try {
            const source = await readNodepodAsset(import.meta.url, relativePath);
            const contentType = relativePath.endsWith(".wasm")
              ? "application/wasm"
              : relativePath.endsWith(".json")
                ? "application/json; charset=utf-8"
                : "application/javascript; charset=utf-8";
            res.setHeader("Content-Type", contentType);
            res.setHeader("Cache-Control", "no-cache");
            if (relativePath.endsWith(".js")) {
              const origin = getRequestOrigin(req);
              for (const [key, value] of Object.entries(workerResponseHeaders(origin))) {
                res.setHeader(key, value);
              }
            }
            res.statusCode = 200;
            res.end(source);
          } catch (error) {
            res.statusCode = 404;
            res.setHeader("Content-Type", "text/plain; charset=utf-8");
            res.end(
              `[nodepod/vite] failed to read asset: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
          return;
        }
        const hostname = String(req.headers?.host ?? "").replace(/:\d+$/, "");
        const isPreviewHost =
          /^.+-\d+\.localhost$/i.test(hostname) ||
          /^.+-\d+\.preview\..+$/i.test(hostname);
        const acceptsHtml = String(req.headers?.accept ?? "").includes(
          "text/html",
        );
        const isNavigation = req.headers?.["sec-fetch-mode"] === "navigate";
        const isInternalPreviewAsset =
          url === swPath ||
          url === DEFAULT_BRIDGE_HTML_PATH ||
          url === DEFAULT_BRIDGE_SCRIPT_PATH ||
          url === WORKER_ASSET_PATH;
        // The first visit can be a client-router deep link. Before the preview
        // worker exists, every document navigation on its dedicated hostname
        // must receive the bootstrap rather than the host app's SPA fallback.
        const isPreviewBootstrap =
          isPreviewHost &&
          !isInternalPreviewAsset &&
          (url === "/" || isNavigation || acceptsHtml);
        if (url === WORKER_ASSET_PATH) {
          // Process-worker bundle only exists after the package build.
          const source = await readWorkerBundleSource(import.meta.url).catch(() => null);
          if (source === null) return next();
          const origin = getRequestOrigin(req);
          for (const [key, value] of Object.entries(workerResponseHeaders(origin))) {
            res.setHeader(key, value);
          }
          res.statusCode = 200;
          res.end(req.method === "HEAD" ? undefined : source);
          return;
        }
        if (
          isPreviewBootstrap ||
          url === DEFAULT_BRIDGE_HTML_PATH ||
          url === DEFAULT_BRIDGE_SCRIPT_PATH
        ) {
          try {
            const isHtml =
              isPreviewBootstrap || url === DEFAULT_BRIDGE_HTML_PATH;
            const source = await readPreviewBridgeSource(
              import.meta.url,
              isHtml ? "html" : "script",
            );
            const bridgeMode = isHtml
              ? new URL(
                  req.url ?? "",
                  "http://nodepod.local",
                ).searchParams.get("mode")
              : null;
            const responseMode = isPreviewBootstrap
              ? "top"
              : bridgeMode === "top" || bridgeMode === "parent"
                ? bridgeMode
                : null;
            const headers = previewBridgeResponseHeaders(
              isHtml ? "text/html" : "application/javascript",
              responseMode,
            );
            for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
            res.statusCode = 200;
            res.end(source);
          } catch (err) {
            res.statusCode = 500;
            res.setHeader("Content-Type", "text/plain");
            res.end(
              `[nodepod/vite] failed to read preview bridge: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
          return;
        }
        if (url !== swPath) return next();
        try {
          const source = await readServiceWorkerSource(import.meta.url);
          const headers = swResponseHeaders();
          for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
          res.statusCode = 200;
          res.end(source);
        } catch (err) {
          res.statusCode = 500;
          res.setHeader("Content-Type", "text/plain");
          const msg = err instanceof Error ? err.message : String(err);
          res.end(`[nodepod/vite] failed to read __sw__.js: ${msg}`);
        }
      });
    },
    configurePreviewServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url?.split("?")[0] ?? "";
        if (url.startsWith(`${NODEPOD_ASSET_PREFIX}egress/`)) {
          await handleNodepodEgress(req, res, opts.egressHosts);
          return;
        }
        let source: Buffer | string | null = null;
        let relativePath: string | null = null;
        if (url === WORKER_ASSET_PATH) {
          source = await readWorkerBundleSource(import.meta.url);
        } else if (url.startsWith(NODEPOD_ASSET_PREFIX)) {
          relativePath = url.slice(NODEPOD_ASSET_PREFIX.length);
          try {
            source = await readNodepodAsset(import.meta.url, relativePath);
          } catch (error) {
            res.statusCode = 404;
            res.setHeader("Content-Type", "text/plain; charset=utf-8");
            res.end(
              `[nodepod/vite] failed to read asset: ${error instanceof Error ? error.message : String(error)}`,
            );
            return;
          }
        }
        if (source === null) return next();

        if (relativePath?.endsWith(".wasm")) {
          res.setHeader("Content-Type", "application/wasm");
        } else if (relativePath?.endsWith(".json")) {
          res.setHeader("Content-Type", "application/json; charset=utf-8");
        } else {
          const origin = getRequestOrigin(req);
          for (const [key, value] of Object.entries(workerResponseHeaders(origin))) {
            res.setHeader(key, value);
          }
        }
        res.setHeader("Cache-Control", "no-cache");
        res.statusCode = 200;
        res.end(req.method === "HEAD" ? undefined : source);
      });
    },
    async generateBundle() {
      const source = await readServiceWorkerSource(import.meta.url);
      this.emitFile({
        type: "asset",
        fileName: assetFileName,
        source,
      });
      this.emitFile({
        type: "asset",
        fileName: DEFAULT_BRIDGE_HTML_PATH.replace(/^\/+/, ""),
        source: await readPreviewBridgeSource(import.meta.url, "html"),
      });
      this.emitFile({
        type: "asset",
        fileName: DEFAULT_BRIDGE_SCRIPT_PATH.replace(/^\/+/, ""),
        source: await readPreviewBridgeSource(import.meta.url, "script"),
      });
      const workerSource = await readWorkerBundleSource(import.meta.url).catch(() => null);
      if (workerSource !== null) {
        this.emitFile({
          type: "asset",
          fileName: WORKER_ASSET_PATH.replace(/^\/+/, ""),
          source: workerSource,
        });
      }
      for (const relativePath of await listNodepodAssets(import.meta.url)) {
        this.emitFile({
          type: "asset",
          fileName: `${NODEPOD_ASSET_PREFIX.slice(1)}${relativePath}`,
          source: await readNodepodAsset(import.meta.url, relativePath),
        });
      }
    },
  };
}

// Also expose as named for `import { nodepod } from '@r1ck404/nodepod/vite'`.
export { nodepod };
export { workerSrcDirective } from "./shared/headers";
