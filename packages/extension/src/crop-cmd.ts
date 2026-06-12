/**
 * /crop (F3): surgical removal of huge tool/MCP results. Interactive review in
 * the panel (default), rule-based pre-marking with --auto, --dry-run never
 * writes. Apply = branch at the anchor + ONE crop-tail reconstruction block
 * (TRD §5 revised) + a ctree/crop marker. Originals stay recoverable (G4).
 */

import {
	CTREE_CROP,
	CTREE_CROP_TAIL,
	type CropPlan,
	SessionTree,
	autoSelect,
	cropCandidates,
	fmtTokens,
	planCrop,
	renderReconstruction,
} from "@pi-context-tree/core";
import { type CmdCtxLike, type PiLike, leafIdOf } from "./adapter.ts";
import { refreshAmbient } from "./ambient.ts";
import { openPanel } from "./panel-cmd.ts";
import { deriveState } from "./state.ts";

interface CropFlags {
	auto: boolean;
	dryRun: boolean;
	apply: boolean;
	minTokens?: number;
	olderThan?: number;
	keep: string[];
}

export function parseCropFlags(args: string): CropFlags {
	const tokens = args.trim().split(/\s+/).filter(Boolean);
	const flags: CropFlags = { auto: false, dryRun: false, apply: false, keep: [] };
	for (let i = 0; i < tokens.length; i++) {
		const t = tokens[i];
		if (t === "--auto") flags.auto = true;
		else if (t === "--dry-run") flags.dryRun = true;
		else if (t === "--apply") flags.apply = true;
		else if (t === "--min-tokens") flags.minTokens = Number(tokens[++i]);
		else if (t === "--older-than") flags.olderThan = Number(tokens[++i]);
		else if (t === "--keep") {
			const g = tokens[++i];
			if (g) flags.keep.push(g);
		}
	}
	return flags;
}

function notifyDryRun(ctx: CmdCtxLike, plan: CropPlan): void {
	const lines = plan.stubs.map((s) => `${s.tool}${s.arg ? ` ${s.arg}` : ""} ~${fmtTokens(s.estTokens)}`);
	ctx.ui.notify(
		`(dry-run) would crop ${plan.stubs.length}: ${lines.join(" · ")} — reclaim ~${fmtTokens(plan.reclaimTokens)}; nothing written`,
		"info",
	);
}

/** Apply a reviewed plan. Re-validates the leaf (TRD §6) before writing. */
export async function applyCropPlan(pi: PiLike, ctx: CmdCtxLike, plan: CropPlan): Promise<void> {
	await ctx.waitForIdle();
	const leafNow = leafIdOf(ctx);
	if (leafNow !== plan.sourceLeafId) {
		ctx.ui.notify("session changed while the crop panel was open — re-run /crop (nothing written)", "warning");
		return;
	}
	if (!plan.anchorId) {
		ctx.ui.notify("cannot crop the very first entry of a session", "error");
		return;
	}
	const state = deriveState(ctx);
	const block = renderReconstruction(state.tree, plan.sourceLeafId, plan);

	const nav = await ctx.navigateTree(plan.anchorId, { summarize: false });
	if (nav.cancelled) {
		ctx.ui.notify("crop aborted — navigation cancelled, nothing written", "warning");
		return;
	}
	// triggerTurn:false with NO deliverAs — same reasoning as merge.ts: the reconstruction block
	// must be in the session before the ctree/crop marker, not staged for a hypothetical next turn.
	pi.sendMessage(
		{
			customType: CTREE_CROP_TAIL,
			content: block,
			display: true,
			details: { v: 1, sourceLeafId: plan.sourceLeafId, stubbed: plan.stubs },
		},
		{ triggerTurn: false },
	);
	pi.appendEntry(CTREE_CROP, { v: 1, sourceLeafId: plan.sourceLeafId, stubbed: plan.stubs });
	refreshAmbient(pi, ctx);
	ctx.ui.notify(
		`✂ cropped ${plan.stubs.length} entr${plan.stubs.length === 1 ? "y" : "ies"} → stubs · ~${fmtTokens(plan.reclaimTokens)} reclaimed · originals on the previous branch`,
		"info",
	);
}

export async function cropHandler(pi: PiLike, ctx: CmdCtxLike, args: string): Promise<void> {
	await ctx.waitForIdle();
	const flags = parseCropFlags(args);
	const state = deriveState(ctx);
	if (!state.leafId) {
		ctx.ui.notify("empty session — nothing to crop", "warning");
		return;
	}

	const candidates = cropCandidates(state.tree, state.leafId);
	if (candidates.length === 0) {
		ctx.ui.notify("no tool/MCP results on this branch — nothing to crop", "info");
		return;
	}

	if (flags.apply && !flags.auto) {
		ctx.ui.notify("--apply needs --auto rules (interactive review applies from the panel)", "error");
		return;
	}

	const premark = flags.auto
		? autoSelect(candidates, { minTokens: flags.minTokens, olderThanTurns: flags.olderThan, keep: flags.keep })
		: [];

	// headless: --auto --apply skips the panel entirely (scriptable + works without a TUI, e.g. RPC mode)
	if (flags.auto && flags.apply) {
		if (premark.length === 0) {
			ctx.ui.notify("--auto matched nothing (protected/latest results are skipped) — nothing to crop", "info");
			return;
		}
		const plan = planCrop(state.tree, state.leafId, premark);
		if (flags.dryRun) {
			notifyDryRun(ctx, plan);
			return;
		}
		await applyCropPlan(pi, ctx, plan);
		return;
	}

	if (flags.auto && premark.length === 0) {
		ctx.ui.notify("--auto matched nothing (protected/latest results are skipped) — opening review anyway", "info");
	}

	const action = await openPanel(pi, ctx, { initialView: "crop", premark, dryRun: flags.dryRun });
	if (!action || action.type !== "crop-apply") return;

	if (action.dryRun) {
		notifyDryRun(ctx, action.plan);
		return;
	}
	await applyCropPlan(pi, ctx, action.plan);
}

export function registerCrop(pi: PiLike): void {
	pi.registerCommand("crop", {
		description: "pi-context-tree: surgically stub out huge tool/MCP results (interactive; --auto --apply --dry-run)",
		handler: (args, ctx) => cropHandler(pi, ctx, args),
		getArgumentCompletions: (prefix) => {
			const flags = ["--auto", "--apply", "--dry-run", "--min-tokens", "--older-than", "--keep"];
			const last = prefix.split(/\s+/).pop() ?? "";
			const hits = flags.filter((f) => f.startsWith(last));
			return hits.length ? hits.map((value) => ({ value })) : null;
		},
	});
}
