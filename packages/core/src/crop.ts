/**
 * Crop planning (F3) — pure functions; applying a plan is the extension's job.
 *
 * v1 mechanism (TRD §5, revised): pi cannot stub individual mid-history
 * entries, so a crop = branch at the anchor (parent of the earliest marked
 * entry) + ONE reconstruction block carrying the kept tail with stub lines in
 * place of cropped bodies. Originals stay on the abandoned branch (G4).
 */

import { createHash } from "node:crypto";
import { estimateEntryTokens, fmtTokens } from "./estimate.ts";
import { serializeEntry } from "./serialize.ts";
import { type SessionTree, contextSlice } from "./tree.ts";
import type { CtreeCropStub, MessageEntry, SessionEntry, UserContent } from "./types.ts";
import { isMessageEntry } from "./types.ts";

export interface CropCandidate {
	entryId: string;
	tool: string;
	arg?: string;
	estTokens: number;
	/** assistant messages after this entry on the path (freshness proxy) */
	ageTurns: number;
	/** latest result of its tool — needs an explicit double-mark (F3.3) */
	protected: boolean;
}

export interface AutoRules {
	minTokens?: number;
	olderThanTurns?: number;
	/** globs matched against tool name and primary arg; matches are kept (never auto-marked) */
	keep?: string[];
}

export interface CropPlan {
	marked: string[];
	/** parent of the earliest marked entry — the new branch point */
	anchorId: string | null;
	reclaimTokens: number;
	stubs: CtreeCropStub[];
	sourceLeafId: string;
}

const PRIMARY_ARG_KEYS = ["path", "file_path", "url", "command", "query", "name"];

function textOf(content: UserContent): string {
	if (typeof content === "string") return content;
	return content.map((b) => (b.type === "text" ? b.text : "[image]")).join("\n");
}

/** Find the toolCall arguments paired with a toolResult (for primary-arg display). */
function primaryArg(tree: SessionTree, entry: MessageEntry): string | undefined {
	const m = entry.message;
	if (m.role === "bashExecution") return m.command.slice(0, 60);
	if (m.role !== "toolResult") return undefined;
	const parent = entry.parentId ? tree.get(entry.parentId) : undefined;
	if (!parent || !isMessageEntry(parent) || parent.message.role !== "assistant") return undefined;
	for (const block of parent.message.content) {
		if (block.type === "toolCall" && block.id === m.toolCallId) {
			const args = block.arguments ?? {};
			for (const key of PRIMARY_ARG_KEYS) {
				const v = args[key];
				if (typeof v === "string" && v.length > 0) return v.slice(0, 60);
			}
			const first = Object.values(args).find((v) => typeof v === "string" && v.length > 0);
			return typeof first === "string" ? first.slice(0, 60) : undefined;
		}
	}
	return undefined;
}

function toolNameOf(e: SessionEntry): string | undefined {
	if (!isMessageEntry(e)) return undefined;
	if (e.message.role === "toolResult") return e.message.toolName;
	if (e.message.role === "bashExecution") return e.message.excludeFromContext ? undefined : "bash";
	return undefined;
}

export function cropCandidates(tree: SessionTree, leafId: string): CropCandidate[] {
	const slice = contextSlice(tree, leafId);

	// ages: assistant messages strictly after each position
	const assistantsAfter: number[] = new Array(slice.length).fill(0);
	let count = 0;
	for (let i = slice.length - 1; i >= 0; i--) {
		assistantsAfter[i] = count;
		const e = slice[i];
		if (e && isMessageEntry(e) && e.message.role === "assistant") count += 1;
	}

	const latestPerTool = new Map<string, string>();
	for (const e of slice) {
		const tool = toolNameOf(e);
		if (tool) latestPerTool.set(tool, e.id);
	}

	const out: CropCandidate[] = [];
	slice.forEach((e, i) => {
		const tool = toolNameOf(e);
		if (!tool) return;
		out.push({
			entryId: e.id,
			tool,
			arg: primaryArg(tree, e as MessageEntry),
			estTokens: estimateEntryTokens(e),
			ageTurns: assistantsAfter[i] ?? 0,
			protected: latestPerTool.get(tool) === e.id,
		});
	});
	return out;
}

function globToRegex(glob: string): RegExp {
	const escaped = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
	return new RegExp(`^${escaped}$`);
}

export function autoSelect(candidates: CropCandidate[], rules: AutoRules): string[] {
	const minTokens = rules.minTokens ?? 10_000;
	const olderThan = rules.olderThanTurns ?? 2;
	const keep = (rules.keep ?? []).map(globToRegex);
	return candidates
		.filter((c) => !c.protected)
		.filter((c) => c.estTokens >= minTokens)
		.filter((c) => c.ageTurns > olderThan)
		.filter((c) => !keep.some((re) => re.test(c.tool) || (c.arg !== undefined && re.test(c.arg))))
		.map((c) => c.entryId);
}

export function planCrop(tree: SessionTree, leafId: string, markedIds: string[]): CropPlan {
	const slice = contextSlice(tree, leafId);
	const position = new Map(slice.map((e, i) => [e.id, i]));
	const croppable = new Set(cropCandidates(tree, leafId).map((c) => c.entryId));

	for (const id of markedIds) {
		if (!position.has(id)) throw new Error(`entry ${id} is not on the current path`);
		if (!croppable.has(id)) throw new Error(`entry ${id} is not croppable (only tool/MCP results are)`);
	}

	const ordered = [...markedIds].sort((a, b) => (position.get(a) ?? 0) - (position.get(b) ?? 0));
	const earliest = ordered[0];
	if (!earliest) throw new Error("nothing marked");

	const stubs: CtreeCropStub[] = ordered.map((id) => {
		const entry = tree.get(id) as MessageEntry;
		const body =
			entry.message.role === "bashExecution"
				? entry.message.output
				: textOf((entry.message as { content: UserContent }).content);
		return {
			entryId: id,
			tool: toolNameOf(entry) ?? "tool",
			arg: primaryArg(tree, entry),
			estTokens: estimateEntryTokens(entry),
			sha8: createHash("sha256").update(body).digest("hex").slice(0, 8),
		};
	});

	return {
		marked: ordered,
		anchorId: tree.get(earliest)?.parentId ?? null,
		reclaimTokens: stubs.reduce((s, x) => s + x.estTokens, 0),
		stubs,
		sourceLeafId: leafId,
	};
}

export function stubLine(s: CtreeCropStub): string {
	const arg = s.arg ? ` ${s.arg}` : "";
	return `[cropped: ${s.tool}${arg}, ~${fmtTokens(s.estTokens)}, ${s.sha8}]`;
}

function serializeWithStubs(e: SessionEntry, stubbed: Map<string, CtreeCropStub>): string | undefined {
	const stub = stubbed.get(e.id);
	if (stub) return stubLine(stub);
	return serializeEntry(e);
}

/**
 * The single custom_message body that replaces the tail on the new branch
 * point. Everything after the anchor, in order, with marked bodies stubbed.
 */
export function renderReconstruction(tree: SessionTree, leafId: string, plan: CropPlan): string {
	const slice = contextSlice(tree, leafId);
	const stubbed = new Map(plan.stubs.map((s) => [s.entryId, s]));
	const startIdx = slice.findIndex((e) => e.id === plan.marked[0]);
	const tail = startIdx === -1 ? slice : slice.slice(startIdx);

	const header = `[ctree/crop: rebuilt context after cropping ${plan.stubs.length} entries, ~${fmtTokens(
		plan.reclaimTokens,
	)} tokens reclaimed. Originals preserved on the previous branch (leaf ${plan.sourceLeafId}).]`;

	const body = tail
		.map((e) => serializeWithStubs(e, stubbed))
		.filter((s): s is string => Boolean(s))
		.join("\n\n");

	return `${header}\n\n${body}\n`;
}
