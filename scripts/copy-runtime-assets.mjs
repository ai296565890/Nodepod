import { cp, mkdir, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const assetRoot = join(root, "dist", "__nodepod");
const packageRoot = (path) => join(root, "node_modules", path);

async function copyFile(source, destination) {
  await mkdir(dirname(destination), { recursive: true });
  await cp(await realpath(source), destination);
}

async function copyFiles(sourceRoot, destinationRoot, files) {
  for (const file of files) {
    await copyFile(join(sourceRoot, file), join(destinationRoot, file));
  }
}

await rm(join(assetRoot, "assets"), { recursive: true, force: true });
await mkdir(assetRoot, { recursive: true });

const legacyRuntimeRoot = join(assetRoot, "legacy-runtime");
await rm(legacyRuntimeRoot, { recursive: true, force: true });
await mkdir(legacyRuntimeRoot, { recursive: true });
for (const name of await readdir(join(root, "dist"))) {
  if (name === "index.mjs" || /^[\w-]+-[\w-]+\.js$/.test(name)) {
    await copyFile(
      join(root, "dist", name),
      join(legacyRuntimeRoot, name),
    );
  }
}

for (const file of [
  "source-worker.js",
  "wasm-compile-worker.js",
  "deflate-worker.js",
]) {
  await copyFile(
    join(root, "static", "nodepod", file),
    join(assetRoot, file),
  );
}

await copyFiles(
  packageRoot("@r1ck404/fast-esbuild-wasm"),
  join(assetRoot, "assets", "fast-esbuild-wasm"),
  ["esm/browser.min.js", "lib/browser.min.js"],
);
await copyFiles(
  packageRoot("pako"),
  join(assetRoot, "assets", "fast-pako"),
  ["index.mjs", "fastzlib.wasm.mjs"],
);
await copyFiles(
  packageRoot("brotli-wasm"),
  join(assetRoot, "assets", "fast-brotli-wasm"),
  ["core.mjs", "pkg.web.mjs", "fastbrotli.wasm"],
);

const rollupRoot = packageRoot("@rollup/browser");
await copyFiles(
  rollupRoot,
  join(assetRoot, "assets", "rollup-browser"),
  ["dist/es/rollup.browser.js", "dist/es/bindings_wasm_bg.wasm", "dist/es/package.json"],
);

const sqliteRoot = packageRoot("wa-sqlite");
await copyFiles(
  sqliteRoot,
  join(assetRoot, "assets", "wa-sqlite"),
  ["dist/wa-sqlite.mjs", "dist/wa-sqlite.wasm"],
);

const lightningRoot = packageRoot("lightningcss-wasm");
const lightningOut = join(assetRoot, "assets", "lightningcss-wasm");
await mkdir(lightningOut, { recursive: true });
await copyFile(
  join(lightningRoot, "lightningcss_node.wasm"),
  join(lightningOut, "lightningcss_node.wasm"),
);
const lightningBundle = await build({
  entryPoints: [join(lightningRoot, "index.mjs")],
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  outfile: join(lightningOut, "index.mjs"),
  assetNames: "[name]-[hash]",
  loader: { ".wasm": "file" },
  write: false,
});
for (const output of lightningBundle.outputFiles) {
  await writeFile(output.path, output.contents);
}

await writeFile(
  join(assetRoot, "runtime-dependencies.json"),
  JSON.stringify({
    nodepod: JSON.parse(await readFile(join(root, "package.json"), "utf8")).version,
    fastEsbuildWasm: "0.28.5",
    fastPako: "2.1.2",
    rollupBrowser: "4.44.0",
    fastBrotliWasm: "3.0.3",
    lightningcssWasm: "1.31.1",
    waSqlite: "1.0.0",
  }, null, 2) + "\n",
);
