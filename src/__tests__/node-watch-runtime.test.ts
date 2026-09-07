import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryVolume } from "../memory-volume";
import {
  executeNodeWatch,
  setSpawnChildCallback,
  type SpawnChildOperation,
  type SpawnChildCallback,
} from "../polyfills/child_process";
import type { ShellContext } from "../shell/shell-types";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function makeCtx(volume: MemoryVolume, signal: AbortSignal): ShellContext {
  return {
    cwd: "/project",
    env: { PWD: "/project" },
    volume,
    signal,
    exec: vi.fn(),
  } as unknown as ShellContext;
}

function pendingChild(onKill?: () => void): {
  operation: SpawnChildOperation;
  resolve: () => void;
} {
  let resolve!: (value: { pid: number; exitCode: number; stdout: string; stderr: string }) => void;
  const promise = new Promise<{ pid: number; exitCode: number; stdout: string; stderr: string }>((r) => {
    resolve = r;
  });
  const operation = Object.assign(promise, {
    kill: vi.fn(() => {
      onKill?.();
      resolve({ pid: 123, exitCode: 0, stdout: "", stderr: "" });
      return true;
    }),
  }) as SpawnChildOperation;
  return { operation, resolve: () => resolve({ pid: 123, exitCode: 0, stdout: "", stderr: "" }) };
}

afterEach(() => {
  setSpawnChildCallback(null);
});

describe("node --watch runtime", () => {
  it("restarts when a runtime-loaded dependency changes", async () => {
    const volume = new MemoryVolume();
    volume.mkdirSync("/project", { recursive: true });
    volume.writeFileSync("/project/a.js", "require('./dep.js')\nsetInterval(() => {}, 1000)\n");
    volume.writeFileSync("/project/dep.js", "module.exports = 1\n");

    const abort = new AbortController();
    const spawned: SpawnChildOperation[] = [];
    const spawn = vi.fn((_command: string, _args: string[], opts: Parameters<SpawnChildCallback>[2]) => {
      const child = pendingChild();
      spawned.push(child.operation);
      queueMicrotask(() => {
        opts?.onModuleLoad?.("/project/a.js");
        opts?.onModuleLoad?.("/project/dep.js");
      });
      return child.operation;
    });
    setSpawnChildCallback(spawn);

    const watching = executeNodeWatch(
      "a.js",
      [],
      makeCtx(volume, abort.signal),
      { enabled: true, preserveOutput: true },
    );

    await delay(10);
    expect(spawn).toHaveBeenCalledTimes(1);

    volume.writeFileSync("/project/dep.js", "module.exports = 2\n");
    await delay(120);
    expect(spawn).toHaveBeenCalledTimes(2);
    expect(spawned[0].kill).toHaveBeenCalled();

    abort.abort();
    const result = await watching;
    expect(result.exitCode).toBe(130);
    expect(spawned[1].kill).toHaveBeenCalled();
  });

  it("does not restart for unrelated files when dependency watching is active", async () => {
    const volume = new MemoryVolume();
    volume.mkdirSync("/project", { recursive: true });
    volume.writeFileSync("/project/a.js", "require('./dep.js')\n");
    volume.writeFileSync("/project/dep.js", "module.exports = 1\n");
    volume.writeFileSync("/project/other.js", "module.exports = 0\n");

    const abort = new AbortController();
    const spawn = vi.fn((_command: string, _args: string[], opts: Parameters<SpawnChildCallback>[2]) => {
      const child = pendingChild();
      queueMicrotask(() => {
        opts?.onModuleLoad?.("/project/a.js");
        opts?.onModuleLoad?.("/project/dep.js");
      });
      return child.operation;
    });
    setSpawnChildCallback(spawn);

    const watching = executeNodeWatch(
      "a.js",
      [],
      makeCtx(volume, abort.signal),
      { enabled: true, preserveOutput: true },
    );

    await delay(10);
    volume.writeFileSync("/project/other.js", "module.exports = 1\n");
    await delay(100);
    expect(spawn).toHaveBeenCalledTimes(1);

    abort.abort();
    await watching;
  });

  it("--watch-path disables dependency filtering and watches the explicit path", async () => {
    const volume = new MemoryVolume();
    volume.mkdirSync("/project/src", { recursive: true });
    volume.writeFileSync("/project/a.js", "console.log('a')\n");
    volume.writeFileSync("/project/src/data.txt", "1\n");

    const abort = new AbortController();
    const spawn = vi.fn((_command: string, _args: string[]) => pendingChild().operation);
    setSpawnChildCallback(spawn);

    const watching = executeNodeWatch(
      "a.js",
      [],
      makeCtx(volume, abort.signal),
      { enabled: true, paths: ["src"], preserveOutput: true },
    );

    await delay(10);
    volume.writeFileSync("/project/src/data.txt", "2\n");
    await delay(120);
    expect(spawn).toHaveBeenCalledTimes(2);

    abort.abort();
    await watching;
  });
});
