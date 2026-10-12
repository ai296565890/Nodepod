"use strict";

self.addEventListener("message", async (event) => {
  const { id, buf } = event.data;
  try {
    const stream = new Blob([buf])
      .stream()
      .pipeThrough(new CompressionStream("deflate-raw"));
    const output = await new Response(stream).arrayBuffer();
    self.postMessage({ id, buf: output }, [output]);
  } catch (error) {
    self.postMessage({
      id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});
