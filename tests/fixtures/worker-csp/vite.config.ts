import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import nodepod, { workerSrcDirective } from "@r1ck404/nodepod/vite";

function securityHeaders() {
  const middleware = (request, response, next) => {
    const host = String(request.headers.host ?? "");
    const origin = new URL(`http://${host}`).origin;
    response.setHeader(
      "Content-Security-Policy",
      [
        "default-src 'none'",
        "script-src 'self'",
        `worker-src ${workerSrcDirective(origin)}`,
        `connect-src ${origin} ws://127.0.0.1:4177`,
        "style-src 'self'",
        "object-src 'none'",
        "base-uri 'none'",
      ].join("; "),
    );
    next();
  };
  return {
    name: "nodepod-worker-csp-fixture",
    configureServer(server) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    },
  };
}

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  plugins: [nodepod(), securityHeaders()],
  server: {
    host: "127.0.0.1",
    port: 4177,
    strictPort: true,
    allowedHosts: ["127.0.0.1", "localhost"],
  },
});
