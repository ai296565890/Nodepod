import { describe, expect, it, vi } from "vitest";
import { MemoryVolume } from "../memory-volume";
import { createNodeCommand } from "../shell/commands/node";
import type { PmDeps } from "../shell/commands/pm-types";
import type { ShellContext } from "../shell/shell-types";

function makeDeps(): PmDeps {
  return {
    executeNodeBinary: vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 })),
    evalCode: vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 })),
    printCode: vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 })),
    hasFile: () => true,
    readFile: () => "",
    writeFile: () => {},
  } as unknown as PmDeps;
}

function makeCtx(): ShellContext {
  const volume = new MemoryVolume();
  volume.mkdirSync("/project", { recursive: true });
  volume.writeFileSync("/project/a.js", "console.log('a')\n");
  return {
    cwd: "/project",
    env: { PWD: "/project" },
    volume,
  } as unknown as ShellContext;
}

describe("node --watch CLI", () => {
  it("passes watch mode to the node executor", async () => {
    const deps = makeDeps();
    const cmd = createNodeCommand(deps);
    const ctx = makeCtx();

    const result = await cmd.execute(["--watch", "a.js", "x"], ctx);

    expect(result.exitCode).toBe(0);
    expect(deps.executeNodeBinary).toHaveBeenCalledWith(
      "a.js",
      ["x"],
      ctx,
      {
        watch: {
          enabled: true,
          paths: undefined,
          preserveOutput: false,
        },
      },
    );
  });

  it("supports --watch-path and --watch-preserve-output", async () => {
    const deps = makeDeps();
    const cmd = createNodeCommand(deps);
    const ctx = makeCtx();

    await cmd.execute(
      ["--watch-path=src", "--watch-path", "config", "--watch-preserve-output", "a.js"],
      ctx,
    );

    expect(deps.executeNodeBinary).toHaveBeenCalledWith(
      "a.js",
      [],
      ctx,
      {
        watch: {
          enabled: true,
          paths: ["src", "config"],
          preserveOutput: true,
        },
      },
    );
  });

  it("rejects --watch with --check", async () => {
    const deps = makeDeps();
    const cmd = createNodeCommand(deps);
    const ctx = makeCtx();

    const result = await cmd.execute(["--watch", "--check", "a.js"], ctx);

    expect(result.exitCode).toBe(9);
    expect(deps.executeNodeBinary).not.toHaveBeenCalled();
  });
});
