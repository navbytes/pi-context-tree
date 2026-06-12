/**
 * Golden-file comparison. Missing goldens are recorded on first run (commit
 * them); UPDATE_GOLDENS=1 re-records. Any other mismatch fails with a diff.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect } from "vitest";

const GOLDEN_DIR = join(dirname(fileURLToPath(import.meta.url)), "__goldens__");

export function expectGolden(name: string, actual: string): void {
	const file = join(GOLDEN_DIR, name);
	if (process.env.UPDATE_GOLDENS === "1" || !existsSync(file)) {
		mkdirSync(GOLDEN_DIR, { recursive: true });
		writeFileSync(file, actual);
		return;
	}
	const expected = readFileSync(file, "utf8");
	expect(actual, `golden mismatch: ${name} — re-record with UPDATE_GOLDENS=1 if the change is intended`).toBe(expected);
}
