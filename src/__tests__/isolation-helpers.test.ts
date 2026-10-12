import { describe, expect, it } from "vitest";
import { generateSandboxDeployment, getSandboxPageHtml } from "../isolation-helpers";

describe("sandbox bootstrap assets", () => {
  it("defaults to the locally served Nodepod runtime entrypoint", () => {
    const html = getSandboxPageHtml({ enableServiceWorker: false });
    expect(html).toContain("'/__nodepod/legacy-runtime/index.mjs'");
    expect(html).not.toContain("unpkg.com");
  });

  it("preserves an explicitly configured runtime URL", () => {
    const html = getSandboxPageHtml({
      nodepodUrl: "https://runtime.example.test/nodepod.mjs",
      enableServiceWorker: false,
    });
    expect(html).toContain("'https://runtime.example.test/nodepod.mjs'");
  });

  it("requires an explicit runtime URL for standalone deployments", () => {
    expect(() => generateSandboxDeployment({ enableServiceWorker: false }))
      .toThrow(/requires nodepodUrl/);
  });
});
