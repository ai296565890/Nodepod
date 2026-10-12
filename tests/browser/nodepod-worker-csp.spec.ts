import { expect, test } from "@playwright/test";

test("same-origin Workers receive isolated CSP and Nodepod runs TypeScript", async ({ page }) => {
  const directRemoteRequests: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).origin !== "http://127.0.0.1:4177") {
      directRemoteRequests.push(request.url());
    }
  });

  const workerResponse = await page.request.get("/__nodepod/source-worker.js");
  expect(workerResponse.ok()).toBeTruthy();
  expect(workerResponse.headers()["content-security-policy"]).toContain(
    "script-src 'self' 'unsafe-eval'",
  );
  expect(workerResponse.headers()["content-security-policy"]).toContain(
    "connect-src http://127.0.0.1:4177/__nodepod/assets/ http://127.0.0.1:4177/__nodepod/egress/",
  );

  const legacyRuntimeResponse = await page.request.get(
    "/__nodepod/legacy-runtime/index.mjs",
  );
  expect(legacyRuntimeResponse.ok()).toBeTruthy();
  expect(await legacyRuntimeResponse.text()).not.toContain("unpkg.com");

  const pageResponse = await page.goto("/");
  const pageCsp = pageResponse?.headers()["content-security-policy"] ?? "";
  expect(pageCsp).toContain("script-src 'self'");
  expect(pageCsp).not.toContain("'unsafe-eval'");
  expect(pageCsp).toContain("worker-src http://127.0.0.1:4177/__worker__.js");
  const result = await page.evaluate(async () => {
    await window.__nodepodTestDone;
    return {
      worker: window.__workerCspResult,
      nodepod: window.__nodepodResult,
    };
  });
  expect(result.worker).toEqual({
    nested: {
      parentEval: 23,
      privateFetch: "blocked",
      egressStatus: 502,
      child: 73,
    },
    blobWorkerResult: "blocked",
  });
  expect(result.nodepod).toMatchObject({
    stdout: "nodepod-typescript-worker-ok\n",
    exitCode: 0,
  });
  expect(directRemoteRequests).toEqual([]);
});
