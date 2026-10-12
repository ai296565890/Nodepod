// deflate-raw off the calling thread: one small worker running the native
// CompressionStream (zlib in C++, default level). Used to pack installed
// package content without spending main-thread time on it; inflating the
// result synchronously (pako.inflateRaw) stays on the reader's side.

import { nodepodAssetUrl } from "./nodepod-assets";

export interface OffThreadDeflater {
  /** deflate-raw of `bytes`. The buffer is transferred: don't use it afterwards. */
  deflate(bytes: Uint8Array): Promise<Uint8Array>;
  dispose(): void;
}

// the worker holds a thread and a heap: drop it between packing rounds
const IDLE_MS = 5000;

/** null where workers or CompressionStream aren't available. */
export function createOffThreadDeflater(): OffThreadDeflater | null {
  if (
    typeof Worker === "undefined" ||
    typeof CompressionStream === "undefined" ||
    typeof location === "undefined"
  ) {
    return null;
  }
  let worker: Worker | null = null;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  let nextId = 1;
  const pending = new Map<number, { resolve: (b: Uint8Array) => void; reject: (e: Error) => void }>();

  const stop = (): void => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = null;
    worker?.terminate();
    worker = null;
    for (const p of pending.values()) p.reject(new Error("deflate worker stopped"));
    pending.clear();
  };

  const ensure = (): Worker => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = null;
    if (worker) return worker;
    const w = new Worker(nodepodAssetUrl("deflate-worker.js"));
    w.onmessage = (e: MessageEvent) => {
      const { id, buf, error } = e.data as { id: number; buf?: ArrayBuffer; error?: string };
      const p = pending.get(id);
      if (!p) return;
      pending.delete(id);
      if (buf) p.resolve(new Uint8Array(buf));
      else p.reject(new Error(error || "deflate failed"));
      if (pending.size === 0) {
        idleTimer = setTimeout(() => {
          if (pending.size === 0) stop();
        }, IDLE_MS);
      }
    };
    w.onerror = () => stop();
    worker = w;
    return w;
  };

  return {
    deflate(bytes: Uint8Array): Promise<Uint8Array> {
      return new Promise((resolve, reject) => {
        let w: Worker;
        try {
          w = ensure();
        } catch (e) {
          reject(e instanceof Error ? e : new Error(String(e)));
          return;
        }
        const id = nextId++;
        pending.set(id, { resolve, reject });
        const buf =
          bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
            ? bytes.buffer
            : bytes.slice().buffer;
        w.postMessage({ id, buf }, [buf as ArrayBuffer]);
      });
    },
    dispose(): void {
      stop();
    },
  };
}
