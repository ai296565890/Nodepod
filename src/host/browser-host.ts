import { openSnapshotCache } from "../persistence/idb-cache";
import { openOPFSSnapshotCache } from "../persistence/opfs-snapshot-cache";
import { createIndexedDBWorkspaceStore } from "../persistence/workspace/idb-store";
import { registerDefaultHostFactory } from "./runtime-host";
import { nodepodAssetUrl } from "../helpers/nodepod-assets";
import type {
  HostWorker,
  HttpIngress,
  OpenSnapshotCacheOptions,
  RuntimeHost,
  WorkerSpec,
} from "./types";

function wrapBrowserWorker(worker: Worker): HostWorker {
  return worker as unknown as HostWorker;
}

export function createBrowserHost(): RuntimeHost {
  let externalWorkerUrl: string | null = null;
  let workerProbePromise: Promise<string | null> | null = null;

  return {
    kind: "browser",

    canCreateWorkers(): boolean {
      return typeof Worker !== "undefined";
    },

    createWorker(spec: WorkerSpec): HostWorker {
      if (typeof Worker === "undefined") {
        throw new Error("[Nodepod] Web Workers are required.");
      }

      if (spec.type === "url") {
        const w = wrapBrowserWorker(new Worker(spec.url, { name: spec.name }));
        w.__nodepodDirect = true;
        return w;
      }

      if (spec.type === "source") {
        const worker = wrapBrowserWorker(
          new Worker(nodepodAssetUrl("source-worker.js"), { name: spec.name }),
        );
        worker.postMessage({ __nodepod_source__: spec.source });
        return worker;
      }

      const url = spec.embedded
        ? new URL("/__worker__.js", location.origin).href
        : externalWorkerUrl ?? new URL("/__worker__.js", location.origin).href;
      const worker = wrapBrowserWorker(new Worker(url, { name: spec.name }));
      worker.__nodepodDirect = true;
      return worker;
    },

    async probeProcessWorkerUrl(workerUrl?: string): Promise<string | null> {
      if (workerProbePromise) return workerProbePromise;
      workerProbePromise = (async () => {
        if (typeof fetch === "undefined") return null;
        let url: string | null = workerUrl ?? null;
        if (!url) {
          try {
            url = new URL("/__worker__.js", location.origin).href;
          } catch {
            return null;
          }
          if (!/^https?:/.test(url)) return null;
        }
        try {
          const resp = await fetch(url, { method: "HEAD" });
          if (!resp.ok) return null;
          const contentType = resp.headers.get("content-type") || "";
          if (contentType && !/javascript|ecmascript/i.test(contentType)) {
            return null;
          }
          externalWorkerUrl = url;
          return url;
        } catch {
          return null;
        }
      })();
      return workerProbePromise;
    },

    disposeGlobalResources(): void {
      externalWorkerUrl = null;
      workerProbePromise = null;
    },

    async openSnapshotCache(
      opts: OpenSnapshotCacheOptions,
    ): Promise<Awaited<ReturnType<typeof openSnapshotCache>>> {
      if (opts.enableSnapshotCache === false || opts.packageStore === "memory") {
        return null;
      }
      try {
        if (opts.packageStore === "opfs") {
          const opfs = await openOPFSSnapshotCache();
          if (opfs) return opfs;
        }
        return await openSnapshotCache();
      } catch {
        return null;
      }
    },

    async openWorkspaceStore(id: string) {
      return createIndexedDBWorkspaceStore(id);
    },

    createHttpIngress(): HttpIngress {
      return { kind: "programmatic", baseUrl: null };
    },
  };
}

// Publish the browser factory on globalThis. Esbuild minify can DCE calls to
// `registerDefaultHostFactory` across chunks, but keeps this assignment —
// `getRuntimeHost()` falls back to the global hook when the factory var is unset.
(globalThis as Record<string, unknown>).__NODEPOD_CREATE_BROWSER_HOST__ =
  createBrowserHost;
registerDefaultHostFactory(createBrowserHost);
