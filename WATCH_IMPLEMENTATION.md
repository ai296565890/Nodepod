# NodePod `node --watch` implementation

## Goal

Implement Node-like watch mode without requiring project-specific watcher scripts.

## Runtime model

```text
node --watch app.js
      |
      v
Node CLI parser
      |
      v
watch supervisor (parent process worker)
      |
      +--> child process worker #1
      |       |
      |       +--> ScriptEngine module loader
      |                |
      |                +--> module-load(path)
      |
VFS recursive watcher <-------- loaded dependency set
      |
file change matches entry/dependency
      |
      +--> SIGTERM child #1
      +--> spawn child #2
```

The important design choice is full process-worker restart. Watch mode does **not** use `delete require.cache[...]`; timers, servers, sockets, listeners and other process-local state disappear with the old worker.

## Files changed

- `src/shell/commands/node.ts`
  - Parses `--watch`, `--watch-path`, `--watch-path=...`, `--watch-preserve-output`.
- `src/shell/commands/pm-types.ts`
  - Adds typed watch options.
- `src/script-engine.ts`
  - Adds `onModuleLoad` hook and reports entry/dependency loads.
- `src/polyfills/child_process.ts`
  - Adds `executeNodeWatch()` supervisor, debounce, dependency filtering, process restart and signal cleanup.
- `src/threading/worker-protocol.ts`
  - Adds module-load messages across worker boundaries.
- `src/threading/process-worker-entry.ts`
  - Emits loaded modules and routes child module-load messages.
- `src/threading/process-handle.ts`
  - Exposes module-load worker messages as process-handle events.
- `src/threading/process-manager.ts`
  - Relays child module-load events to the watch supervisor.
- `src/__tests__/node-watch-command.test.ts`
  - CLI parsing tests.
- `src/__tests__/node-watch-runtime.test.ts`
  - Runtime restart/filter/explicit-path tests.

## Expected behavior

With:

```js
// app.js
require('./dep.js')
setInterval(() => console.log('running'), 1000)
```

changing either `app.js` or `dep.js` should cause a fresh process restart.

Changing an unrelated file should not restart default `--watch` mode.

With:

```bash
node --watch-path src app.js
```

any VFS change under `src/` restarts the process.

## Validation note

The source was statically syntax-checked for the modified TypeScript files. Full `pnpm install` / Vitest execution could not be run in the artifact environment because outbound npm registry access is unavailable. Run the repository's normal `pnpm install`, `pnpm run type-check`, and targeted Vitest tests in a network-enabled environment before publishing.
