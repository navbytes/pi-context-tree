/**
 * pi package entry point (loaded via the `pi.extensions` manifest in
 * package.json, or by `extensions/` convention). The real extension lives in
 * the workspace package; built workspace deps come from `prepare` on install.
 */

export { default } from "../packages/extension/src/index.ts";
