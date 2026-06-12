/**
 * Forest → text rendering for the pitree CLI (pure; colors optional so tests
 * assert plain strings).
 */

import { type Forest, type SessionSummary, fmtTokens } from "@pi-context-tree/core";
import chalk from "chalk";

export interface PrintOptions {
	danglingOnly?: boolean;
	color?: boolean;
}

function statusGlyph(presentation: string, c: typeof chalk | null): string {
	const map: Record<string, [string, (s: string) => string]> = {
		active: ["●", c ? c.green : (s) => s],
		dangling: ["⚠", c ? c.yellow : (s) => s],
		squashed: ["✓", c ? c.blue : (s) => s],
		rejected: ["✗", c ? c.red : (s) => s],
	};
	const [glyph, paint] = map[presentation] ?? ["·", (s: string) => s];
	return paint(glyph);
}

function sessionLines(s: SessionSummary, c: typeof chalk | null): string[] {
	const dim = c ? c.gray : (x: string) => x;
	const file = s.path.split("/").pop() ?? s.path;
	const name = s.name ? `"${s.name}" ` : "";
	const head = `  ${name}${file} ${dim(`· ${s.entryCount} entries · ~${fmtTokens(s.leafTokens)} leaf ctx`)}`;
	const lines = [head];
	for (const f of s.forks) {
		lines.push(`    ${statusGlyph(f.presentation, c)} ⎇ ${f.name} ${dim(`· ${f.status}`)}`);
	}
	if (s.dangling.length > 0) {
		const warn = c ? c.yellow : (x: string) => x;
		lines.push(`    ${warn(`⚠ dangling: ${s.dangling.join(", ")}`)}`);
	}
	for (const w of s.warnings) lines.push(`    ${dim(`! ${w}`)}`);
	return lines;
}

export function forestToLines(forest: Forest, opts: PrintOptions = {}): string[] {
	const c = opts.color ? chalk : null;
	const bold = c ? c.bold : (x: string) => x;
	const dim = c ? c.gray : (x: string) => x;
	const lines: string[] = [];

	let projects = forest.projects;
	if (opts.danglingOnly) {
		projects = projects
			.map((p) => ({ ...p, sessions: p.sessions.filter((s) => s.dangling.length > 0) }))
			.filter((p) => p.sessions.length > 0);
	}

	const totalSessions = projects.reduce((n, p) => n + p.sessions.length, 0);
	const totalDangling = projects.reduce((n, p) => n + p.sessions.reduce((m, s) => m + s.dangling.length, 0), 0);
	lines.push(
		`${bold("pitree")} ${dim(`· ${forest.root} · ${projects.length} projects · ${totalSessions} sessions`)}${
			totalDangling > 0 ? ` · ${c ? c.yellow(`⚠ ${totalDangling} dangling`) : `⚠ ${totalDangling} dangling`}` : ""
		}`,
	);

	for (const p of projects) {
		const cwd = p.sessions[0]?.header?.cwd;
		lines.push(`${bold(cwd ?? p.dir)}`);
		for (const s of p.sessions) lines.push(...sessionLines(s, c));
	}
	if (projects.length === 0)
		lines.push(dim(opts.danglingOnly ? "(no dangling branches — clean forest)" : "(no sessions found)"));
	return lines;
}
