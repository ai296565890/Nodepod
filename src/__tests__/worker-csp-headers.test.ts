import { describe, expect, it } from "vitest";
import {
  workerResponseHeaders,
  workerSrcDirective,
} from "../integrations/shared/headers";

describe("same-origin Worker CSP", () => {
  it("keeps eval permission and network access inside dedicated Worker routes", () => {
    const headers = workerResponseHeaders("https://nodepod.example.test");
    const policy = headers["Content-Security-Policy"];

    expect(policy).toContain("script-src 'self' 'unsafe-eval'");
    expect(policy).toContain(
      "connect-src https://nodepod.example.test/__nodepod/assets/ https://nodepod.example.test/__nodepod/egress/",
    );
    expect(policy).toContain(
      "worker-src https://nodepod.example.test/__worker__.js https://nodepod.example.test/__nodepod/source-worker.js https://nodepod.example.test/__nodepod/engine-worker.js https://nodepod.example.test/__nodepod/wasm-compile-worker.js https://nodepod.example.test/__nodepod/deflate-worker.js",
    );
    expect(policy).not.toContain("blob:");
    expect(policy).not.toContain("worker-src 'self'");
  });

  it("builds an exact Worker URL list for the host document", () => {
    expect(workerSrcDirective("https://nodepod.example.test")).toBe(
      "https://nodepod.example.test/__worker__.js " +
        "https://nodepod.example.test/__nodepod/source-worker.js " +
        "https://nodepod.example.test/__nodepod/engine-worker.js " +
        "https://nodepod.example.test/__nodepod/wasm-compile-worker.js " +
        "https://nodepod.example.test/__nodepod/deflate-worker.js",
    );
  });

  it("rejects unsupported origins", () => {
    expect(() => workerResponseHeaders("blob:https://nodepod.example.test/id"))
      .toThrow(/Unsupported Worker asset origin/);
    expect(() => workerSrcDirective("file:///nodepod"))
      .toThrow(/Unsupported Worker source origin/);
  });
});
