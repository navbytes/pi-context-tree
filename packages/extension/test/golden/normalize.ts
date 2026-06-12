/**
 * Normalize a pi session JSONL for golden-file comparison. Maps entry ids to
 * e00N in file order (including occurrences inside content strings and entry
 * data), and replaces timestamps, dates, cwd paths and response ids with
 * placeholders. Entry order, types, payloads and usage are preserved — those
 * are what the goldens pin down.
 */

const ISO_TS = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g;
const ISO_DATE = /\b\d{4}-\d{2}-\d{2}\b/g;
const NUMERIC_TIME_KEYS = new Set(["timestamp", "createdAt", "created"]);

export interface NormalizeOptions {
	/** Defaults to the session header's cwd. Both /var and /private/var forms are replaced. */
	cwd?: string;
}

function cwdVariants(cwd: string): string[] {
	const variants = new Set([cwd]);
	if (cwd.startsWith("/private/")) variants.add(cwd.slice("/private".length));
	else if (cwd.startsWith("/")) variants.add(`/private${cwd}`);
	return [...variants].sort((a, b) => b.length - a.length);
}

export function normalizeSession(jsonl: string, opts: NormalizeOptions = {}): string {
	const parsed = jsonl
		.split("\n")
		.filter((l) => l.trim() !== "")
		.map((l) => JSON.parse(l) as Record<string, unknown>);

	const idMap = new Map<string, string>();
	let seq = 0;
	for (const obj of parsed) {
		if (obj.type === "session") continue;
		const id = obj.id;
		if (typeof id === "string" && !idMap.has(id)) idMap.set(id, `e${String(++seq).padStart(3, "0")}`);
	}

	const header = parsed.find((o) => o.type === "session");
	const cwd = opts.cwd ?? (typeof header?.cwd === "string" ? header.cwd : undefined);
	const cwds = cwd ? cwdVariants(cwd) : [];

	const mapString = (s: string): string => {
		let out = s;
		for (const c of cwds) out = out.split(c).join("<cwd>");
		for (const [from, to] of idMap) {
			if (out.includes(from)) out = out.replace(new RegExp(`\\b${from}\\b`, "g"), to);
		}
		out = out.replace(ISO_TS, "<ts>");
		out = out.replace(ISO_DATE, "<date>");
		return out;
	};

	const walk = (value: unknown, key?: string): unknown => {
		if (typeof value === "string") {
			if (key === "responseId") return "<resp>";
			return mapString(value);
		}
		if (typeof value === "number" && key !== undefined && NUMERIC_TIME_KEYS.has(key)) return 0;
		if (Array.isArray(value)) return value.map((v) => walk(v));
		if (value !== null && typeof value === "object") {
			const out: Record<string, unknown> = {};
			for (const [k, v] of Object.entries(value)) out[k] = walk(v, k);
			return out;
		}
		return value;
	};

	const lines = parsed.map((obj) => {
		const walked = walk(obj) as Record<string, unknown>;
		if (obj.type === "session") walked.id = "<session>";
		return JSON.stringify(walked);
	});
	return `${lines.join("\n")}\n`;
}
