import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { request as httpsRequest } from "node:https";
import type { IncomingMessage, ServerResponse } from "node:http";

const PREFIX = "/__nodepod/egress/";
const DEFAULT_EGRESS_HOSTS = [
  "registry.npmjs.org",
  "github.com",
  "raw.githubusercontent.com",
  "api.github.com",
  "objects.githubusercontent.com",
  "esm.sh",
  "unpkg.com",
  "cdn.jsdelivr.net",
];
const REQUEST_BODY_LIMIT = 2 * 1024 * 1024;
const RESPONSE_BODY_LIMIT = 128 * 1024 * 1024;
const MAX_REDIRECTS = 5;
const REQUEST_TIMEOUT_MS = 60_000;
const MAX_CONCURRENT_REQUESTS = 8;
const FORWARDED_REQUEST_HEADERS = [
  "accept",
  "accept-encoding",
  "content-type",
  "if-modified-since",
  "if-none-match",
  "range",
  "user-agent",
] as const;
const FORWARDED_RESPONSE_HEADERS = [
  "accept-ranges",
  "cache-control",
  "content-encoding",
  "content-length",
  "content-range",
  "content-type",
  "etag",
  "last-modified",
] as const;

let activeRequests = 0;

function isPublicIpv4(address: string): boolean {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => part < 0 || part > 255)) {
    return false;
  }
  const value = parts.reduce((result, part) => result * 256 + part, 0);
  const blocked: Array<[number, number]> = [
    [0x00000000, 8],
    [0x0a000000, 8],
    [0x64400000, 10],
    [0x7f000000, 8],
    [0xa9fe0000, 16],
    [0xac100000, 12],
    [0xc0000000, 24],
    [0xc0000200, 24],
    [0xc0586300, 24],
    [0xc0a80000, 16],
    [0xc6120000, 15],
    [0xc6336400, 24],
    [0xcb007100, 24],
    [0xe0000000, 4],
    [0xf0000000, 4],
  ];
  return !blocked.some(([network, bits]) => {
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return ((value & mask) >>> 0) === network;
  });
}

function parseTarget(encoded: string, hosts: Set<string>): URL {
  let decoded: string;
  try {
    decoded = decodeURIComponent(encoded);
  } catch {
    throw new Error("Malformed egress target encoding.");
  }
  const target = new URL(decoded);
  const hostname = target.hostname.toLowerCase();
  const allowedHost = [...hosts].some(
    (host) => hostname === host || hostname.endsWith(`.${host}`),
  );
  if (
    target.protocol !== "https:" ||
    target.username ||
    target.password ||
    (target.port && target.port !== "443") ||
    !allowedHost
  ) {
    throw new Error("Egress target is not permitted.");
  }
  target.hash = "";
  return target;
}

async function publicIpv4(hostname: string): Promise<string> {
  if (isIP(hostname)) {
    if (isIP(hostname) !== 4 || !isPublicIpv4(hostname)) {
      throw new Error("Egress target resolves to a non-public address.");
    }
    return hostname;
  }
  const addresses = await lookup(hostname, { all: true, family: 4, verbatim: true });
  const publicAddresses = addresses.filter(
    (entry) => isPublicIpv4(entry.address),
  );
  if (addresses.length === 0 || publicAddresses.length !== addresses.length) {
    throw new Error("Egress target resolves to a non-public address.");
  }
  return publicAddresses[0].address;
}

async function readRequestBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += data.length;
    if (length > REQUEST_BODY_LIMIT) {
      throw new Error(`Egress request body exceeds ${REQUEST_BODY_LIMIT} bytes.`);
    }
    chunks.push(data);
  }
  return Buffer.concat(chunks, length);
}

function writeFailure(response: ServerResponse, error: unknown): void {
  if (response.headersSent) {
    response.destroy(error instanceof Error ? error : new Error(String(error)));
    return;
  }
  response.statusCode = 502;
  response.setHeader("Content-Type", "text/plain; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.end(
    `Nodepod egress request failed: ${error instanceof Error ? error.message : String(error)}`,
  );
}

async function requestTarget(
  target: URL,
  method: string,
  headers: Record<string, string>,
  body: Buffer,
  redirectCount: number,
  hosts: Set<string>,
): Promise<{ status: number; headers: IncomingMessage["headers"]; body: Buffer }> {
  const address = await publicIpv4(target.hostname);
  const response = await new Promise<IncomingMessage>((resolve, reject) => {
    const outgoing = httpsRequest(
      {
        hostname: target.hostname,
        servername: target.hostname,
        port: 443,
        method,
        path: `${target.pathname}${target.search}`,
        headers,
        lookup: (_hostname, _options, callback) => callback(null, address, 4),
      },
      resolve,
    );
    outgoing.setTimeout(REQUEST_TIMEOUT_MS, () => {
      outgoing.destroy(new Error("Egress request timed out."));
    });
    outgoing.once("error", reject);
    if (body.length > 0) outgoing.write(body);
    outgoing.end();
  });

  const status = response.statusCode ?? 502;
  const location = response.headers.location;
  if ([301, 302, 303, 307, 308].includes(status) && location) {
    response.resume();
    if (redirectCount >= MAX_REDIRECTS) {
      throw new Error("Egress redirect limit exceeded.");
    }
    if (method !== "GET" && method !== "HEAD") {
      throw new Error("Egress redirects for requests with bodies are not permitted.");
    }
    const nextTarget = new URL(location, target);
    const safeTarget = parseTarget(encodeURIComponent(nextTarget.href), hosts);
    return requestTarget(
      safeTarget,
      method,
      headers,
      Buffer.alloc(0),
      redirectCount + 1,
      hosts,
    );
  }

  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of response) {
    const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += data.length;
    if (length > RESPONSE_BODY_LIMIT) {
      response.destroy(new Error(`Egress response exceeds ${RESPONSE_BODY_LIMIT} bytes.`));
      throw new Error(`Egress response exceeds ${RESPONSE_BODY_LIMIT} bytes.`);
    }
    chunks.push(data);
  }
  return { status, headers: response.headers, body: Buffer.concat(chunks, length) };
}

export async function handleNodepodEgress(
  request: IncomingMessage,
  response: ServerResponse,
  configuredHosts: string[] = [],
): Promise<boolean> {
  const requestPath = request.url?.split("?")[0] ?? "";
  if (!requestPath.startsWith(PREFIX)) return false;

  if (activeRequests >= MAX_CONCURRENT_REQUESTS) {
    response.statusCode = 503;
    response.setHeader("Retry-After", "1");
    response.end("Nodepod egress concurrency limit reached.");
    return true;
  }

  activeRequests += 1;
  try {
    const hosts = new Set([
      ...DEFAULT_EGRESS_HOSTS,
      ...configuredHosts.map((host) => host.toLowerCase()),
    ]);
    const target = parseTarget(requestPath.slice(PREFIX.length), hosts);
    const method = (request.method ?? "GET").toUpperCase();
    if (!/^(GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS)$/.test(method)) {
      response.statusCode = 405;
      response.setHeader("Allow", "GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS");
      response.end("Egress method is not permitted.");
      return true;
    }

    const headers: Record<string, string> = {};
    for (const name of FORWARDED_REQUEST_HEADERS) {
      const value = request.headers[name];
      if (typeof value === "string") headers[name] = value;
    }
    const body = method === "GET" || method === "HEAD"
      ? Buffer.alloc(0)
      : await readRequestBody(request);
    if (body.length > 0) headers["content-length"] = String(body.length);

    const result = await requestTarget(target, method, headers, body, 0, hosts);
    response.statusCode = result.status;
    for (const name of FORWARDED_RESPONSE_HEADERS) {
      const value = result.headers[name];
      if (typeof value === "string") response.setHeader(name, value);
    }
    response.setHeader("Cache-Control", result.headers["cache-control"] ?? "no-store");
    response.end(method === "HEAD" ? undefined : result.body);
  } catch (error) {
    writeFailure(response, error);
  } finally {
    activeRequests -= 1;
  }
  return true;
}
