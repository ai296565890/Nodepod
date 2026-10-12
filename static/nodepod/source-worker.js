"use strict";

const initializeFromSource = (event) => {
  const source = event.data?.__nodepod_source__;
  if (typeof source !== "string") return;
  self.removeEventListener("message", initializeFromSource);
  try {
    (0, eval)(source);
  } catch (error) {
    self.postMessage({
      __nodepod_source_error__: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
};

self.addEventListener("message", initializeFromSource);
