"use strict";

self.addEventListener("message", (event) => {
  try {
    const module = new WebAssembly.Module(event.data.bytes);
    self.postMessage({ id: event.data.id, ok: true, module });
  } catch (error) {
    self.postMessage({
      id: event.data.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});
