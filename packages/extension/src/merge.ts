/**
 * /merge (F2): close the nearest open branch via squash (decision record,
 * human-confirmed), squash --no-llm, discard, or tournament. Always navigates
 * with summarize:false so pi's own BranchSummaryEntry never doubles up with a
 * decision record (F2.5). Write order: decision → close markers → model
 * restore (TRD §5).
 */

import {
	CTREE_CLOSE,
	CTREE_DECISION,
	type ForkInfo,
	renderDecisionRecord,
	serializeEntries,
	siblingForks,
} from "@pi-context-tree/core";
import {
	type CmdCtxLike,
	type Deps,
	type PiLike,
	appendAndGetId,
	lastEntryId,
	modelKey,
	resolveModel,
} from "./adapter.ts";
import { refreshAmbient } from "./ambient.ts";
import { DRAFT_SYSTEM_PROMPT, draftUserPrompt } from "./draft.ts";
import { type SessionState, branchEntries, deriveState } from "./state.ts";

type MergeMode = "squash" | "no-llm" | "discard" | "tournament";

function parseArgs(args: string): { mode?: MergeMode; note: string } {
	const tokens = args.trim().split(/\s+/).filter(Boolean);
	let mode: MergeMode | undefined;
	const rest: string[] = [];
	for (const t of tokens) {
		if (t === "--squash") mode = "squash";
		else if (t === "--no-llm") mode = "no-llm";
		else if (t === "--discard") mode = "discard";
		else if (t === "--tournament") mode = "tournament";
		else rest.push(t);
	}
	return { mode, note: rest.join(" ") };
}

async function pickMode(ctx: CmdCtxLike, fork: ForkInfo, siblings: ForkInfo[]): Promise<MergeMode | undefined> {
	const options = [
		"squash — draft a decision record with the branch model, you confirm/edit",
		"squash --no-llm — write the decision record yourself",
		"discard — return to the label, inject nothing, mark rejected",
		siblings.length > 0
			? `tournament — winner record + epitaphs for ${siblings.length} sibling(s), ONE combined node`
			: "tournament — (needs open siblings sharing this label — none found)",
	];
	const choice = await ctx.ui.select(`Merge branch '${fork.data.name}'?`, options);
	if (choice === undefined) return undefined;
	if (choice.startsWith("squash —")) return "squash";
	if (choice.startsWith("squash --no-llm")) return "no-llm";
	if (choice.startsWith("discard")) return "discard";
	if (choice.startsWith("tournament")) return siblings.length > 0 ? "tournament" : undefined;
	return undefined;
}

function recordTemplate(fork: ForkInfo, model: string | undefined): string {
	return renderDecisionRecord({
		branchName: fork.data.name,
		dateIso: new Date().toISOString().slice(0, 10),
		model: model ?? "—",
		branchId: fork.entryId,
		outcome: "",
		why: ["", ""],
	});
}

async function epitaphFor(deps: Deps, ctx: CmdCtxLike, state: SessionState, sib: ForkInfo): Promise<string> {
	const serialized = serializeEntries(siblingTail(state, sib), { perEntryCap: 800 }).slice(0, 8000);
	try {
		const text = await deps.draft(
			ctx,
			sib.data.branchModel,
			"You write one-line epitaphs for rejected engineering approaches. Output ONE line, ≤120 chars, format: <reason it was rejected>.",
			`Branch "${sib.data.name}" lost a tournament. Its transcript:\n---\n${serialized}\n---\nWhy was it rejected? One line.`,
		);
		return text.split("\n", 1)[0]?.slice(0, 160) ?? "rejected";
	} catch {
		const manual = await ctx.ui.input(`epitaph for rejected '${sib.data.name}' (one line)`, "why it lost");
		return manual?.trim() || "rejected in tournament";
	}
}

function siblingTail(state: SessionState, sib: ForkInfo) {
	// entries under the sibling fork (its branch content)
	return state.entries.filter((e) => state.tree.isAncestorOrSelf(sib.entryId, e.id) && e.id !== sib.entryId);
}

export async function mergeHandler(pi: PiLike, ctx: CmdCtxLike, args: string, deps: Deps): Promise<void> {
	await ctx.waitForIdle();
	const state = deriveState(ctx);
	const fork = state.currentFork;
	if (!fork || !state.leafId) {
		ctx.ui.notify("no open branch at or above the current leaf — /branch <name> first (F2.1)", "error");
		return;
	}
	const siblings = siblingForks(state.forks, fork.entryId);

	const parsed = parseArgs(args);
	const mode = parsed.mode ?? (await pickMode(ctx, fork, siblings));
	if (!mode) {
		ctx.ui.notify("merge cancelled — nothing written", "info");
		return;
	}
	if (mode === "tournament" && siblings.length === 0) {
		ctx.ui.notify("tournament needs ≥1 open sibling branch sharing this label (F2.4)", "error");
		return;
	}

	const branchModelRef = fork.data.branchModel ?? modelKey(ctx.model);

	// -- discard: no record, close as discarded --------------------------------
	if (mode === "discard") {
		const note = parsed.note || (await ctx.ui.input("optional one-line note for the close marker", "dead end"));
		const nav = await ctx.navigateTree(fork.entryId, { summarize: false });
		if (nav.cancelled) {
			ctx.ui.notify("merge aborted — navigation cancelled, nothing written", "warning");
			return;
		}
		pi.appendEntry(CTREE_CLOSE, {
			v: 1,
			forkEntryId: fork.entryId,
			status: "discarded",
			note: note?.trim() || undefined,
		});
		await restoreTrunkModel(pi, ctx, fork);
		refreshAmbient(pi, ctx);
		ctx.ui.notify(`⎇ discarded ${fork.data.name} — back at the label, nothing injected (history kept)`, "info");
		return;
	}

	// -- squash / no-llm / tournament: build the record ------------------------
	const template = recordTemplate(fork, branchModelRef);
	let draft: string;
	if (mode === "no-llm") {
		draft = template;
	} else {
		ctx.ui.notify(`drafting decision record with ${branchModelRef ?? "current model"}…`, "info");
		try {
			const serialized = serializeEntries(branchEntries(state, fork.entryId), { perEntryCap: 2000 });
			draft = await deps.draft(
				ctx,
				fork.data.branchModel,
				DRAFT_SYSTEM_PROMPT,
				draftUserPrompt(fork.data.name, template, serialized, parsed.note || undefined),
			);
		} catch (err) {
			ctx.ui.notify(
				`drafting failed (${(err as Error).message}) — falling back to manual template (--no-llm)`,
				"warning",
			);
			draft = template;
		}
	}

	const rejected: { name: string; reason: string }[] = [];
	if (mode === "tournament") {
		for (const sib of siblings) rejected.push({ name: sib.data.name, reason: await epitaphFor(deps, ctx, state, sib) });
		const lines = [draft.trimEnd()];
		if (!draft.includes("### Rejected alternatives")) lines.push("### Rejected alternatives");
		for (const r of rejected) lines.push(`- **${r.name}:** ${r.reason}`);
		draft = `${lines.join("\n")}\n`;
	}

	// -- mandatory human gate (F2.2): nothing lands until accepted --------------
	const confirmed = await ctx.ui.editor(
		`Decision record — review/edit; closing without saving aborts the merge ('${fork.data.name}')`,
		draft,
	);
	if (confirmed === undefined || confirmed.trim() === "") {
		ctx.ui.notify("merge aborted — no record confirmed, nothing written", "info");
		return;
	}

	// -- apply: navigate → decision → close markers → model restore -------------
	const nav = await ctx.navigateTree(fork.entryId, { summarize: false });
	if (nav.cancelled) {
		ctx.ui.notify("merge aborted — navigation cancelled, nothing written", "warning");
		return;
	}
	pi.sendMessage(
		{
			customType: CTREE_DECISION,
			content: confirmed,
			display: true,
			details: { v: 1, forkEntryId: fork.entryId, branchName: fork.data.name, siblings: rejected },
		},
		{ triggerTurn: false, deliverAs: "nextTurn" },
	);
	const decisionEntryId = lastEntryId(ctx) ?? undefined;
	pi.appendEntry(CTREE_CLOSE, { v: 1, forkEntryId: fork.entryId, status: "squashed", decisionEntryId });
	for (const r of rejected) {
		const sib = siblings.find((s) => s.data.name === r.name);
		if (sib) pi.appendEntry(CTREE_CLOSE, { v: 1, forkEntryId: sib.entryId, status: "rejected", note: r.reason });
	}
	await restoreTrunkModel(pi, ctx, fork);
	refreshAmbient(pi, ctx);
	ctx.ui.notify(
		mode === "tournament"
			? `⎇ tournament: ${fork.data.name} won — 1 combined record, ${rejected.length} epitaph(s), siblings closed`
			: `⎇ squashed ${fork.data.name} → decision record on trunk · branch history kept`,
		"info",
	);
}

async function restoreTrunkModel(pi: PiLike, ctx: CmdCtxLike, fork: ForkInfo): Promise<void> {
	const trunkRef = fork.data.trunkModel;
	if (!trunkRef || trunkRef === modelKey(ctx.model)) return;
	const model = resolveModel(ctx, trunkRef);
	if (!model) {
		ctx.ui.notify(`could not resolve trunk model ${trunkRef} — staying on ${modelKey(ctx.model)}`, "warning");
		return;
	}
	const ok = await pi.setModel(model);
	if (!ok) ctx.ui.notify(`no API key for ${trunkRef} — staying on ${modelKey(ctx.model)}`, "warning");
}

export function registerMerge(pi: PiLike, deps: Deps): void {
	pi.registerCommand("merge", {
		description: "pi-context-tree: close the open branch — squash (decision record) | discard | tournament",
		handler: (args, ctx) => mergeHandler(pi, ctx, args, deps),
		getArgumentCompletions: (prefix) => {
			const flags = ["--squash", "--no-llm", "--discard", "--tournament"];
			const last = prefix.split(/\s+/).pop() ?? "";
			const hits = flags.filter((f) => f.startsWith(last));
			return hits.length ? hits.map((value) => ({ value })) : null;
		},
	});
}
