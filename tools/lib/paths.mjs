import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** Source, strictement en lecture seule. */
export const ASSET_DIR = path.join(ROOT, "asset");

/** Produit de compilation, regenerable, ignore par git. */
export const BUILD_DIR = path.join(ROOT, "build");
export const FRAMES_DIR = path.join(BUILD_DIR, "frames");
export const MANIFEST_PATH = path.join(BUILD_DIR, "manifest.json");
export const REVIEW_DIR = path.join(BUILD_DIR, "review");

/** Types derives du manifeste, versionnes avec le code. */
export const GENERATED_TS_PATH = path.join(ROOT, "src/assets/generated/animations.ts");
