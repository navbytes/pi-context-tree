/**
 * Streaming, fault-tolerant reader for pi session JSONL files.
 * Never throws on malformed input: bad lines become warnings, unknown entry
 * types are preserved, legacy v1 linear sessions are migrated to a chain in
 * memory (mirroring pi's own load-time migration).
 */

import { createReadStream } from "node:fs";
import { KNOWN_ENTRY_TYPES, type SessionEntry, type SessionHeader } from "./types.ts";

export interface ParsedSession {
	header: SessionHeader | null;
	entries: SessionEntry[];
	warnings: string[];
}

interface Accumulator {
	header: SessionHeader | null;
	entries: SessionEntry[];
	warnings: string[];
	unknownTypesWarned: Set<string>;
	legacy: boolean;
	legacySeq: number;
	lastId: string | null;
	lineNo: number;
}

function newAccumulator(): Accumulator {
	return {
		header: null,
		entries: [],
		warnings: [],
		unknownTypesWarned: new Set(),
		legacy: false,
		legacySeq: 0,
		lastId: null,
		lineNo: 0,
	};
}

function ingestLine(acc: Accumulator, rawLine: string): void {
	acc.lineNo += 1;
	const line = rawLine.trim();
	if (line === "") return;

	let value: any;
	try {
		value = JSON.parse(line);
	} catch {
		acc.warnings.push(`line ${acc.lineNo}: malformed JSON skipped (truncated write?)`);
		return;
	}
	if (typeof value !== "object" || value === null || typeof value.type !== "string") {
		acc.warnings.push(`line ${acc.lineNo}: not a session entry, skipped`);
		return;
	}

	if (value.type === "session") {
		if (acc.header === null && acc.entries.length === 0) {
			acc.header = value as SessionHeader;
			if (typeof acc.header.version === "number" && acc.header.version < 2) {
				acc.legacy = true;
				acc.warnings.push(`legacy v${acc.header.version} session: migrating linear entries to a chain in memory`);
			}
		} else {
			acc.warnings.push(`line ${acc.lineNo}: unexpected extra session header, skipped`);
		}
		return;
	}

	// Legacy v1 entries have no id/parentId — synthesize a linear chain.
	if (acc.legacy || typeof value.id !== "string") {
		if (!acc.legacy) {
			acc.warnings.push(`line ${acc.lineNo}: entry missing id — treating as legacy linear entry`);
		}
		acc.legacySeq += 1;
		value.id = typeof value.id === "string" ? value.id : `legacy-${String(acc.legacySeq).padStart(4, "0")}`;
		value.parentId = acc.lastId;
		value.timestamp = typeof value.timestamp === "string" ? value.timestamp : new Date(0).toISOString();
	}

	if (!("parentId" in value)) value.parentId = acc.lastId;

	if (!KNOWN_ENTRY_TYPES.has(value.type) && !acc.unknownTypesWarned.has(value.type)) {
		acc.unknownTypesWarned.add(value.type);
		acc.warnings.push(`unknown entry type "${value.type}" preserved as-is (newer pi version?)`);
	}

	acc.entries.push(value as SessionEntry);
	acc.lastId = value.id;
}

function finish(acc: Accumulator): ParsedSession {
	return { header: acc.header, entries: acc.entries, warnings: acc.warnings };
}

export function parseSessionText(text: string): ParsedSession {
	const acc = newAccumulator();
	for (const line of text.split("\n")) ingestLine(acc, line);
	return finish(acc);
}

/** Streaming parse — constant memory per line; suitable for 50MB+ files. */
export async function parseSessionFile(path: string): Promise<ParsedSession> {
	const acc = newAccumulator();
	const stream = createReadStream(path, { encoding: "utf8", highWaterMark: 1 << 20 });
	let carry = "";
	for await (const chunk of stream) {
		carry += chunk;
		let nl = carry.indexOf("\n");
		while (nl !== -1) {
			ingestLine(acc, carry.slice(0, nl));
			carry = carry.slice(nl + 1);
			nl = carry.indexOf("\n");
		}
	}
	if (carry !== "") ingestLine(acc, carry);
	return finish(acc);
}

/** Read only the first line of a session file (cheap forest listing). */
export async function readSessionHeader(path: string): Promise<SessionHeader | null> {
	const stream = createReadStream(path, { encoding: "utf8", highWaterMark: 64 * 1024 });
	let carry = "";
	for await (const chunk of stream) {
		carry += chunk;
		const nl = carry.indexOf("\n");
		if (nl !== -1) {
			stream.destroy();
			carry = carry.slice(0, nl);
			break;
		}
	}
	try {
		const value = JSON.parse(carry.trim());
		return value?.type === "session" ? (value as SessionHeader) : null;
	} catch {
		return null;
	}
}
