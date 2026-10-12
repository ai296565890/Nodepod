import { Nodepod, setProxy } from "@r1ck404/nodepod";

declare global {
  interface Window {
    __workerCspResult?: unknown;
    __nodepodResult?: unknown;
    __nodepodTestDone?: Promise<void>;
  }
}

function checkWorkerCsp(): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const worker = new Worker("/__nodepod/source-worker.js");
    const timeout = setTimeout(() => {
      worker.terminate();
      reject(new Error("Worker CSP check timed out."));
    }, 10_000);
    worker.onerror = (event) => {
      clearTimeout(timeout);
      worker.terminate();
      reject(new Error(event.message || "Worker CSP check failed."));
    };
    worker.onmessage = (event) => {
      clearTimeout(timeout);
      worker.terminate();
      resolve(event.data);
    };
    worker.postMessage({
      __nodepod_source__: `
        const child = new Worker("/__nodepod/source-worker.js");
        child.onmessage = async ({ data }) => {
          const privateFetch = await fetch("/api/private")
            .then(() => "allowed")
            .catch(() => "blocked");
          const egressStatus = await fetch(
            "/__nodepod/egress/" + encodeURIComponent("https://example.com")
          ).then((response) => response.status);
          postMessage({ parentEval: Function("return 23")(), privateFetch, egressStatus, child: data });
          child.terminate();
        };
        child.postMessage({
          __nodepod_source__: 'postMessage(Function("return 73")())'
        });
      `,
    });
  });
}

async function runNodepod(): Promise<unknown> {
  setProxy(`${location.origin}/__nodepod/egress/`);
  const pod = await Nodepod.boot({
    files: {
      "/project/main.ts": 'console.log("nodepod-typescript-worker-ok");',
    },
    workdir: "/project",
    headless: true,
    serviceWorker: false,
    enableSharedArrayBuffer: false,
    enableSnapshotCache: false,
    allowedFetchDomains: [],
  });
  try {
    const process = await pod.spawn("node", ["/project/main.ts"], { cwd: "/project" });
    return await process.completion;
  } finally {
    pod.teardown();
  }
}

window.__nodepodTestDone = (async () => {
  try {
    const blob = new Blob(["postMessage('unexpected')"], {
      type: "text/javascript",
    });
    const blobWorkerResult = await new Promise<string>((resolve) => {
      const worker = new Worker(URL.createObjectURL(blob));
      const timeout = setTimeout(() => {
        worker.terminate();
        resolve("no-response");
      }, 2_000);
      worker.onmessage = () => {
        clearTimeout(timeout);
        worker.terminate();
        resolve("not-blocked");
      };
      worker.onerror = (event) => {
        event.preventDefault();
        clearTimeout(timeout);
        worker.terminate();
        resolve("blocked");
      };
    });
    window.__workerCspResult = {
      nested: await checkWorkerCsp(),
      blobWorkerResult,
    };
    window.__nodepodResult = await runNodepod();
    document.querySelector("#status")!.textContent = "Complete";
  } catch (error) {
    const failure = error instanceof Error ? error.stack ?? error.message : String(error);
    window.__workerCspResult = { error: failure };
    document.querySelector("#status")!.textContent = "Failed";
    throw error;
  }
})();
