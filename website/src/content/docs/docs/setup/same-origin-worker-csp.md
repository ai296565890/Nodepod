---
title: Same-origin Worker CSP
description: Serve Nodepod Workers and pinned runtime dependencies from the host origin with a Worker-only CSP.
sidebar:
  order: 2
---

## Contract status

This contract describes the Nodepod fork based on version **1.11.2**. The fork replaces its browser Blob Worker creation paths with same-origin Worker URLs and serves pinned runtime dependencies from the Vite host. It does not change the host page's `script-src`.

This is a browser execution-policy boundary, **not a security sandbox**. Same-origin Workers can access origin-scoped browser storage such as IndexedDB. CSP does not revoke that capability. Do not use this design to run hostile or mutually untrusted tenant code on an application origin without a separate security review and an accepted storage boundary.

## Worker endpoints and policy

The Vite integration serves these Worker entrypoints:

| Purpose | Same-origin URL |
| --- | --- |
| Process runtime | `/__worker__.js` |
| Source/offload pool | `/__nodepod/source-worker.js` |
| Collaborative runtime engine | `/__nodepod/engine-worker.js` |
| WebAssembly compilation | `/__nodepod/wasm-compile-worker.js` |
| Deflate | `/__nodepod/deflate-worker.js` |

Each Worker entry response receives a dedicated policy:

```text
default-src 'none';
script-src 'self' 'unsafe-eval';
worker-src <the exact Nodepod Worker URL list>;
connect-src <same-origin /__nodepod/assets/> <same-origin /__nodepod/egress/>;
object-src 'none';
base-uri 'none'
```

The host document does not need `unsafe-eval`. Its `worker-src` must enumerate the exact same-origin Worker URLs, without `blob:` or a broad `'self'` source. Chromium verification confirmed that nested same-origin Workers work and a Blob Worker is blocked.

Runtime modules and WebAssembly files are served under `/__nodepod/assets/`. The Worker `connect-src` policy does not include the application's API paths. Cross-origin package reads that Nodepod cannot avoid are routed through `/__nodepod/egress/`, never directly from the browser Worker.

## Pinned same-origin runtime dependencies

| Dependency | Version | Use and served files |
| --- | --- | --- |
| `@r1ck404/fast-esbuild-wasm` | `0.28.5` | Browser ESM and classic browser runtime under `/__nodepod/assets/fast-esbuild-wasm/` |
| `@r1ck404/fast-pako` (`pako` alias) | `2.1.2` | Gzip fallback in the offload Worker, including its ESM companion |
| `@rollup/browser` | `4.44.0` | Browser Rollup module and adjacent bindings WASM |
| `@r1ck404/fast-brotli-wasm` (`brotli-wasm` alias) | `3.0.3` | Browser Brotli module, glue, and adjacent WASM |
| `lightningcss-wasm` | `1.31.1` | Bundled browser module (including `napi-wasm`) and `lightningcss_node.wasm` |
| `wa-sqlite` | `1.0.0` | SQLite module and adjacent WASM |

The legacy iframe bootstrap's default runtime entry is also copied locally to `/__nodepod/legacy-runtime/index.mjs`; its generated module chunks are served alongside it. `getSandboxPageHtml()` uses this same-origin entry by default. The standalone `generateSandboxDeployment()` helper requires an explicit `nodepodUrl` on the generated page's origin; its static output does not itself include Nodepod runtime assets or the dynamic egress handler.

The build writes `dist/__nodepod/runtime-dependencies.json` as the asset inventory. WASM recovery for an installed user package remains dynamic because its package name and version are not known at build time; it is fetched server-side through the restricted egress handler.

## Vite setup

Keep the Nodepod plugin on the same origin as the page:

```ts
import { defineConfig } from "vite";
import nodepod from "@r1ck404/nodepod/vite";

export default defineConfig({
  plugins: [nodepod()],
});
```

The plugin serves Worker CSP headers, the pinned assets, and the restricted egress handler in Vite development and preview. `workerSrcDirective(origin)` is exported from `@r1ck404/nodepod/vite` for constructing the host document's exact `worker-src` list. Production hosting must separately serve the same assets and reproduce the Worker response headers; no production Nginx/Caddy/edge configuration is included in this fork.

Configure the runtime to use the same-origin egress route before booting it:

```ts
import { Nodepod, setProxy } from "@r1ck404/nodepod";

setProxy(new URL("/__nodepod/egress/", location.origin).href);
const pod = await Nodepod.boot({ allowedFetchDomains: [] });
```

If `allowedFetchDomains` is extended, add the same HTTPS host(s) to the Vite plugin's `egressHosts`; both the browser-side allowlist and server-side allowlist must permit the destination.

The development/preview egress handler is intentionally constrained:

- HTTPS only, default port only, and no URL credentials.
- Only Nodepod's known package/CDN/GitHub hosts plus explicitly configured `egressHosts`.
- DNS results are pinned to a public IPv4 address; private, loopback, and reserved destinations are rejected.
- Redirect targets are revalidated, with a five-hop limit.
- Request methods are limited to standard non-CONNECT methods; cookies and authorization headers are not forwarded.
- Request/response body limits are 2 MiB/128 MiB; requests time out after 60 seconds and are concurrency limited.

These controls are not a substitute for a production SSRF review. Do not expose the development/preview egress handler on a production host until the production network boundary, logging, quotas, and host allowlist have been reviewed.

## Chromium verification

The dedicated Playwright fixture was run against Microsoft Edge (Chromium engine) in both Vite development and preview:

- Host page `script-src 'self'` remained strict; no page `unsafe-eval` was required.
- Parent and nested source Workers executed `Function(...)`.
- A Blob Worker was blocked by the page policy.
- Worker `fetch('/api/private')` was blocked; the allowed same-origin egress route responded while rejecting an unlisted target.
- Nodepod executed a TypeScript file and returned exit code `0`.
- The browser made no direct cross-origin requests.

The Playwright-bundled Chromium executable was unavailable in this environment; these results are specifically from the installed Microsoft Edge Chromium browser. Production response headers and deployment behavior remain unverified.

To rerun the checks, build the library first, then run `pnpm test:browser:worker-csp` and `pnpm test:browser:worker-csp:preview`. On Windows with Edge installed, set `$env:NODEPOD_BROWSER_CHANNEL='msedge'` before running the commands.

## Upgrade procedure

1. Pin each runtime dependency version in `package.json` and regenerate `pnpm-lock.yaml`.
2. Review upstream changes for Worker creation, CDN URLs, WASM sidecar paths, and runtime initialization.
3. Update the asset copy/bundle script and `runtime-dependencies.json` version list.
4. Run `pnpm run build:publish`, `pnpm run type-check`, and the targeted unit tests.
5. Run the Worker CSP Playwright tests for both dev and preview in Chromium.
6. Confirm that every Worker uses a listed URL, no Worker path creates a Blob URL, no fixed dependency is fetched from a CDN, and each module's WASM sidecar resolves from the same-origin asset directory.
7. Re-review the production host headers and egress implementation before updating a production deployment.
