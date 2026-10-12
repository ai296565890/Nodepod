const NODEPOD_ASSET_ROOT = "/__nodepod/";

export function nodepodAssetUrl(asset: string): string {
  if (typeof location === "undefined" || !/^https?:$/.test(location.protocol)) {
    throw new Error("[Nodepod] Same-origin worker assets require a browser HTTP(S) origin.");
  }
  return new URL(`${NODEPOD_ASSET_ROOT}${asset}`, location.origin).href;
}
