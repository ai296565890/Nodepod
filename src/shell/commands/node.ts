import type { ShellCommand } from "../shell-types";
import type { PmDeps } from "./pm-types";
import { VERSIONS } from "../../constants/config";
import { parseAst } from "../../polyfills/rollup";
import { isTypeScriptFile, stripTypeScript } from "../../strip-typescript";
import { resolvePath } from "../shell-helpers";

const A_RESET = "\x1b[0m";
const A_BOLD = "\x1b[1m";

export function createNodeCommand(deps: PmDeps): ShellCommand {
  return {
    name: "node",
    async execute(params, ctx) {
      if (!deps.hasFile("/"))
        return { stdout: "", stderr: "Volume unavailable\n", exitCode: 1 };

      let target: string | null = null;
      let evalCode: string | null = null;
      let printCode: string | null = null;
      let checkOnly = false;
      let watchEnabled = false;
      let watchPreserveOutput = false;
      const watchPaths: string[] = [];
      const scriptArgs: string[] = [];
      const execArgv: string[] = [];
      let collectingArgs = false;

      for (let i = 0; i < params.length; i++) {
        if (collectingArgs) {
          scriptArgs.push(params[i]);
          continue;
        }
        if (params[i] === "-e" || params[i] === "--eval") {
          evalCode = params[++i] ?? "";
        } else if (params[i] === "-p" || params[i] === "--print") {
          printCode = params[++i] ?? "";
        } else if (params[i] === "--check" || params[i] === "-c") {
          checkOnly = true;
        } else if (params[i] === "--watch") {
          watchEnabled = true;
        } else if (params[i] === "--watch-preserve-output") {
          watchPreserveOutput = true;
        } else if (params[i] === "--watch-path") {
          const watchPath = params[++i];
          if (watchPath) watchPaths.push(watchPath);
          watchEnabled = true;
        } else if (params[i].startsWith("--watch-path=")) {
          watchPaths.push(params[i].slice("--watch-path=".length));
          watchEnabled = true;
        } else if (params[i] === "--version" || params[i] === "-v") {
          return { stdout: VERSIONS.NODE + "\n", stderr: "", exitCode: 0 };
        } else if (params[i] === "--help" || params[i] === "-h") {
          return {
            stdout: `${A_BOLD}Usage:${A_RESET} node [options] [script.js] [arguments]\n` +
              `  --watch                 restart when entry/dependencies change\n` +
              `  --watch-path <path>     restart when the given path changes\n` +
              `  --watch-preserve-output keep output between restarts\n`,
            stderr: "",
            exitCode: 0,
          };
        } else if (params[i] === "--conditions" || params[i] === "-C") {
          execArgv.push(params[i], params[++i] ?? "");
        } else if (
          params[i] === "-r" ||
          params[i] === "--require" ||
          params[i] === "--experimental-specifier-resolution" ||
          params[i] === "--loader" ||
          params[i] === "--import"
        ) {
          i++;
        } else if (params[i].startsWith("-")) {
          // skip unknown flags (--harmony, --inspect, etc.)
          execArgv.push(params[i]);
        } else {
          target = params[i];
          collectingArgs = true;
        }
      }

      if (watchEnabled && (evalCode !== null || printCode !== null || checkOnly)) {
        return {
          stdout: "",
          stderr: "node: --watch cannot be combined with --eval, --print, or --check\n",
          exitCode: 9,
        };
      }

      if (evalCode !== null) {
        return deps.evalCode(evalCode, ctx);
      }
      if (printCode !== null) {
        return deps.printCode(printCode, ctx);
      }

      if (!target)
        return {
          stdout: "",
          stderr: `${A_BOLD}Usage:${A_RESET} node <file> [args...]\n`,
          exitCode: 1,
        };

      if (checkOnly) {
        const fullPath = resolvePath(target, ctx.cwd);
        let source: string;
        try {
          source = ctx.volume.readFileSync(fullPath, "utf8");
        } catch {
          return {
            stdout: "",
            stderr: `node: ${target}: No such file or directory\n`,
            exitCode: 1,
          };
        }
        const sourceLimit = ctx.limits?.maxExpansionBytes ?? 1024 * 1024;
        if (source.length > sourceLimit) {
          return {
            stdout: "",
            stderr: `node: source exceeds ${sourceLimit} characters\n`,
            exitCode: 1,
          };
        }
        if (isTypeScriptFile(fullPath)) {
          source = stripTypeScript(source, fullPath);
        }
        try {
          parseAst(source, undefined, fullPath);
          return { stdout: "", stderr: "", exitCode: 0 };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return {
            stdout: "",
            stderr: `${fullPath}\n${msg}\n`,
            exitCode: 1,
          };
        }
      }

      const executeOptions = {
        ...(execArgv.length > 0 ? { execArgv } : {}),
        ...(watchEnabled
          ? {
              watch: {
                enabled: true,
                paths: watchPaths.length > 0 ? watchPaths : undefined,
                preserveOutput: watchPreserveOutput,
              },
            }
          : {}),
      };
      return deps.executeNodeBinary(
        target,
        scriptArgs,
        ctx,
        Object.keys(executeOptions).length > 0 ? executeOptions : undefined,
      );
    },
  };
}

export function createNpxCommand(deps: PmDeps): ShellCommand {
  return {
    name: "npx",
    async execute(params, ctx) {
      return deps.npxExecute(params, ctx);
    },
  };
}
