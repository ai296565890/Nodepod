import { readdir, readFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ASSET_ROOTS = ["../__nodepod", "../../dist/__nodepod"];

async function locateAssetRoot(fromFileUrl: string): Promise<string> {
  const baseDir = dirname(fileURLToPath(fromFileUrl));
  for (const relativePath of ASSET_ROOTS) {
    const root = resolve(baseDir, relativePath);
    try {
      await readdir(root);
      return root;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  throw new Error("Nodepod same-origin assets are missing. Run `pnpm build:lib` first.");
}

export async function readNodepodAsset(
  fromFileUrl: string,
  relativePath: string,
): Promise<Buffer> {
  if (
    !relativePath ||
    relativePath.startsWith("/") ||
    relativePath.split(/[\\/]/).some((part) => part === "." || part === "..")
  ) {
    throw new Error("Invalid Nodepod asset path.");
  }
  const root = await locateAssetRoot(fromFileUrl);
  const path = resolve(root, relativePath);
  if (!path.startsWith(`${root}${sep}`)) throw new Error("Invalid Nodepod asset path.");
  return readFile(path);
}

export async function listNodepodAssets(fromFileUrl: string): Promise<string[]> {
  const root = await locateAssetRoot(fromFileUrl);
  const files: string[] = [];

  async function visit(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(path);
      } else if (entry.isFile()) {
        files.push(path.slice(root.length + 1).split(sep).join("/"));
      }
    }
  }

  await visit(root);
  return files.sort();
}
