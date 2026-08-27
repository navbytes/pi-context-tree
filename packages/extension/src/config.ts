/**
 * Minimal user config (~/.pi/agent/pi-context-tree.json): the gauge mode knob.
 * `bar` pins the gauge widget above the editor; `border` renders it into the
 * input box's bottom border instead. Missing/invalid → "bar".
 *
 * Reads are cached: refreshAmbient runs on every turn_end, session_tree and
 * session_start, and a syncronous readFileSync per turn to fetch one string is
 * waste. Writes and the test seam invalidate it.
 *
 * Path is injectable (param or setConfigPath seam) so tests never touch $HOME.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export type GaugeMode = "bar" | "border";

let pathOverride: string | undefined;
let cached: GaugeMode | undefined;

/** test seam — point reads/writes at a temp file (undefined restores default) */
export function setConfigPath(path: string | undefined): void {
	pathOverride = path;
	cached = undefined;
}

function resolvePath(explicit?: string): string {
	return explicit ?? pathOverride ?? join(homedir(), ".pi", "agent", "pi-context-tree.json");
}

function read(path: string): GaugeMode {
	try {
		const parsed = JSON.parse(readFileSync(path, "utf8")) as { gauge?: unknown };
		return parsed?.gauge === "border" ? "border" : "bar";
	} catch {
		return "bar"; // missing file or invalid JSON
	}
}

export function getGaugeMode(path?: string): GaugeMode {
	if (path !== undefined) return read(path); // explicit path bypasses the cache
	if (cached === undefined) cached = read(resolvePath());
	return cached;
}

/** Throws on an unwritable $HOME — callers notify per the panel-cmd.ts convention. */
export function setGaugeMode(mode: GaugeMode, path?: string): void {
	const p = resolvePath(path);
	mkdirSync(dirname(p), { recursive: true });
	// read-modify-write: other keys in the file must survive
	let config: Record<string, unknown> = {};
	try {
		const parsed: unknown = JSON.parse(readFileSync(p, "utf8"));
		if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) config = parsed as Record<string, unknown>;
	} catch {
		// missing file or invalid JSON — start fresh
	}
	config.gauge = mode;
	writeFileSync(p, `${JSON.stringify(config, null, "\t")}\n`);
	if (path === undefined) cached = mode;
}
