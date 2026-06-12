/**
 * Forest scanning (F6/pitree): read-only sweep over a sessions root
 * (~/.pi/agent/sessions), grouping session files by project directory.
 * Dangling = open ctree fork with no close marker.
 */

import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { type ForkInfo, extractForks } from "./ctree.ts";
import { estimateContextTokens } from "./estimate.ts";
import { parseSessionFile, readSessionHeader } from "./jsonl.ts";
import { SessionTree, contextSlice } from "./tree.ts";
import type { SessionHeader } from "./types.ts";

export interface ForkSummary {
	entryId: string;
	name: string;
	status: ForkInfo["status"];
	presentation: ForkInfo["presentation"];
}

export interface SessionSummary {
	path: string;
	header: SessionHeader | null;
	/** session display name from the latest session_info entry */
	name?: string;
	/** -1 in headers-only mode */
	entryCount: number;
	lastTimestamp?: string;
	/** est. tokens of the loaded leaf's context (chars/4) */
	leafTokens: number;
	forks: ForkSummary[];
	/** names of open forks with no close marker */
	dangling: string[];
	warnings: string[];
}

export interface ForestProject {
	dir: string;
	sessions: SessionSummary[];
}

export interface Forest {
	root: string;
	projects: ForestProject[];
}

export async function summarizeSession(path: string): Promise<SessionSummary> {
	const parsed = await parseSessionFile(path);
	const tree = SessionTree.fromEntries(parsed.entries);
	const leafId = tree.fileLeafId();
	const forks = leafId ? extractForks(tree, leafId) : [];

	let name: string | undefined;
	for (let i = parsed.entries.length - 1; i >= 0; i--) {
		const e = parsed.entries[i];
		if (e && e.type === "session_info") {
			name = (e as { name?: string }).name;
			break;
		}
	}

	const last = parsed.entries[parsed.entries.length - 1];
	return {
		path,
		header: parsed.header,
		name,
		entryCount: parsed.entries.length,
		lastTimestamp: last?.timestamp,
		leafTokens: leafId ? estimateContextTokens(contextSlice(tree, leafId)) : 0,
		forks: forks.map((f) => ({
			entryId: f.entryId,
			name: f.data.name,
			status: f.status,
			presentation: f.presentation,
		})),
		dangling: forks.filter((f) => f.status === "open" && !f.onCurrentPath).map((f) => f.data.name),
		warnings: parsed.warnings,
	};
}

async function headerOnlySummary(path: string): Promise<SessionSummary> {
	const header = await readSessionHeader(path);
	return {
		path,
		header,
		entryCount: -1,
		leafTokens: 0,
		forks: [],
		dangling: [],
		warnings: [],
	};
}

export async function scanForest(root: string, opts: { headersOnly?: boolean } = {}): Promise<Forest> {
	const projects: ForestProject[] = [];
	const top = await readdir(root, { withFileTypes: true });

	for (const dirent of top.sort((a, b) => a.name.localeCompare(b.name))) {
		if (!dirent.isDirectory()) continue;
		const dirPath = join(root, dirent.name);
		const files = (await readdir(dirPath)).filter((f) => f.endsWith(".jsonl")).sort();
		if (files.length === 0) continue;

		const sessions: SessionSummary[] = [];
		for (const file of files) {
			const full = join(dirPath, file);
			sessions.push(opts.headersOnly ? await headerOnlySummary(full) : await summarizeSession(full));
		}
		projects.push({ dir: dirent.name, sessions });
	}

	return { root, projects };
}
