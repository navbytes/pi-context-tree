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
import type { CtreeCropDrop, CtreeCropStub, MessageEntry, SessionEntry, UserContent } from "./types.ts";
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
	/** parent of the earliest affected entry (stub or drop) — the new branch point */
	anchorId: string | null;
	reclaimTokens: number;
	stubs: CtreeCropStub[];
	/** whole Q&A turns removed together (question + answers). Empty for plain crops. */
	dropped: CtreeCropDrop[];
	sourceLeafId: string;
}

/** A user question grouped with the answers it spawned, up to the next question. */
export interface ContextTurn {
	/** the user message entry that opens the turn */
	userId: string;
	/** first line of the question */
	label: string;
	/** every member entry id: the user message + its assistant/tool answers */
	entryIds: string[];
	estTokens: number;
}

const PRIMARY_ARG_KEYS = ["path", "file_path", "url", "command", "query", "name"];

function textOf(content: UserContent): string {
	if (typeof content === "string") return content;
	return content.map((b) => (b.type === "text" ? b.text : "[image]")).join("\n");
}

function firstLine(s: string, max = 80): string {
	const line = s.split("\n", 1)[0] ?? "";
	return line.length > max ? `${line.slice(0, max)}…` : line;
}

function isUserMessage(e: SessionEntry): boolean {
	return isMessageEntry(e) && (e as MessageEntry).message.role === "user";
}

function isAnswerEntry(e: SessionEntry): boolean {
	if (!isMessageEntry(e)) return false;
	const role = (e as MessageEntry).message.role;
	return role === "assistant" || role === "toolResult" || role === "bashExecution";
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
		dropped: [],
		sourceLeafId: leafId,
	};
}

/** Group the context into Q&A turns: a user question + the answers it spawned. */
export function contextTurns(tree: SessionTree, leafId: string): ContextTurn[] {
	const slice = contextSlice(tree, leafId);
	const turns: ContextTurn[] = [];
	let cur: ContextTurn | null = null;
	for (const e of slice) {
		if (isUserMessage(e)) {
			cur = {
				userId: e.id,
				// guarded by isUserMessage above — user messages carry UserContent
				label: firstLine(textOf(((e as MessageEntry).message as { content: UserContent }).content)),
				entryIds: [e.id],
				estTokens: estimateEntryTokens(e),
			};
			turns.push(cur);
		} else if (cur && isAnswerEntry(e)) {
			cur.entryIds.push(e.id);
			cur.estTokens += estimateEntryTokens(e);
		} else {
			cur = null; // custom_message / branch_summary / pre-first-user → turn boundary
		}
	}
	return turns;
}

/**
 * Plan removal of whole Q&A turns (question + answers dropped together — half a
 * turn would orphan tool pairs and break user/assistant alternation). Same
 * append-only mechanism as planCrop: branch at the anchor, reconstruction block
 * omits the turns, originals stay recoverable (G4).
 */
export function planRemoveTurns(tree: SessionTree, leafId: string, userIds: string[]): CropPlan {
	const slice = contextSlice(tree, leafId);
	const position = new Map(slice.map((e, i) => [e.id, i]));
	const byUser = new Map(contextTurns(tree, leafId).map((t) => [t.userId, t]));

	for (const id of userIds) {
		if (!byUser.has(id)) throw new Error(`entry ${id} is not a user question (only whole turns can be removed)`);
	}
	const ordered = [...userIds].sort((a, b) => (position.get(a) ?? 0) - (position.get(b) ?? 0));
	const earliest = ordered[0];
	if (!earliest) throw new Error("nothing marked");

	const dropped: CtreeCropDrop[] = ordered.map((uid) => {
		const turn = byUser.get(uid) as ContextTurn;
		const body = turn.entryIds.map((id) => serializeEntry(tree.get(id) as SessionEntry) ?? "").join("\n");
		return {
			userId: uid,
			entryIds: turn.entryIds,
			label: turn.label,
			estTokens: turn.estTokens,
			sha8: createHash("sha256").update(body).digest("hex").slice(0, 8),
		};
	});

	return {
		marked: [],
		anchorId: tree.get(earliest)?.parentId ?? null,
		reclaimTokens: dropped.reduce((s, d) => s + d.estTokens, 0),
		stubs: [],
		dropped,
		sourceLeafId: leafId,
	};
}

export function stubLine(s: CtreeCropStub): string {
	const arg = s.arg ? ` ${s.arg}` : "";
	return `[cropped: ${s.tool}${arg}, ~${fmtTokens(s.estTokens)}, ${s.sha8}]`;
}

export function dropLine(d: CtreeCropDrop): string {
	return `[dropped turn: "${d.label}" — ${d.entryIds.length} entries, ~${fmtTokens(d.estTokens)}, ${d.sha8} — recoverable on the previous branch]`;
}

/**
 * The single custom_message body that replaces the tail on the new branch
 * point. Everything after the anchor, in order: tool results stubbed, whole
 * removed turns collapsed to a drop note, everything else kept verbatim.
 */
export function renderReconstruction(tree: SessionTree, leafId: string, plan: CropPlan): string {
	const slice = contextSlice(tree, leafId);
	const stubbed = new Map(plan.stubs.map((s) => [s.entryId, s]));
	const dropFirst = new Map(plan.dropped.map((d) => [d.entryIds[0] as string, d]));
	const droppedIds = new Set(plan.dropped.flatMap((d) => d.entryIds));

	const affected = [...plan.marked, ...droppedIds];
	const positions = affected.map((id) => slice.findIndex((e) => e.id === id)).filter((i) => i >= 0);
	const startIdx = positions.length ? Math.min(...positions) : 0;
	const tail = slice.slice(startIdx);

	const header =
		plan.dropped.length === 0
			? // backward-compatible header for plain crops (keeps the committed crop golden stable)
				`[ctree/crop: rebuilt context after cropping ${plan.stubs.length} entries, ~${fmtTokens(
					plan.reclaimTokens,
				)} tokens reclaimed. Originals preserved on the previous branch (leaf ${plan.sourceLeafId}).]`
			: `[ctree/crop: rebuilt context after ${[
					`removing ${plan.dropped.length} turn${plan.dropped.length === 1 ? "" : "s"}`,
					plan.stubs.length ? `cropping ${plan.stubs.length} entr${plan.stubs.length === 1 ? "y" : "ies"}` : "",
				]
					.filter(Boolean)
					.join(" + ")}, ~${fmtTokens(
					plan.reclaimTokens,
				)} tokens reclaimed. Originals preserved on the previous branch (leaf ${plan.sourceLeafId}).]`;

	const parts: string[] = [];
	for (const e of tail) {
		const drop = dropFirst.get(e.id);
		if (drop) {
			parts.push(dropLine(drop));
			continue;
		}
		if (droppedIds.has(e.id)) continue; // non-first member of a removed turn
		const stub = stubbed.get(e.id);
		parts.push(stub ? stubLine(stub) : (serializeEntry(e) ?? ""));
	}

	return `${header}\n\n${parts.filter(Boolean).join("\n\n")}\n`;
}
