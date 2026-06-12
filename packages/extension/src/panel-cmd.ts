/**
 * /panel + Ctrl+T (F4): the full-screen Context Panel, hosted as a pi overlay
 * via ctx.ui.custom({overlay:true}) — the mechanism verified public in 0.79.1.
 * The panel returns ONE action; mutations execute back here in command context
 * after re-validation (TRD §6).
 */

import type { PanelAction, PanelInput, PanelView } from "@pi-context-tree/core";
import { ContextPanel } from "@pi-context-tree/tui";
import { type CmdCtxLike, type CtxLike, type Deps, type PiLike, leafIdOf, projectName } from "./adapter.ts";
import { entriesOf } from "./adapter.ts";
import { branchHandler } from "./branch.ts";

export interface PanelOpenOptions {
	initialView?: PanelView;
	premark?: string[];
	dryRun?: boolean;
	readOnly?: boolean;
}

export function buildPanelInput(pi: PiLike, ctx: CtxLike, opts: PanelOpenOptions = {}): PanelInput {
	const usage = ctx.getContextUsage?.();
	return {
		entries: entriesOf(ctx),
		leafId: leafIdOf(ctx),
		project: projectName(),
		sessionName: pi.getSessionName?.(),
		model: ctx.model?.id,
		contextWindow: ctx.model?.contextWindow ?? usage?.contextWindow,
		usageTokens: usage ? usage.tokens : undefined,
		readOnly: opts.readOnly,
		dryRun: opts.dryRun,
		initialView: opts.initialView,
		premark: opts.premark,
	};
}

/** Mount the panel as an overlay; resolves with the action that closed it. */
export async function openPanel(
	pi: PiLike,
	ctx: CtxLike,
	opts: PanelOpenOptions = {},
): Promise<PanelAction | undefined> {
	if (!ctx.ui.custom) {
		ctx.ui.notify("the context panel needs pi's interactive TUI (ui.custom unavailable in this mode)", "warning");
		return undefined;
	}
	const input = buildPanelInput(pi, ctx, opts);
	const action = await ctx.ui.custom<PanelAction>(
		(_tui: unknown, _theme: unknown, _keybindings: unknown, done: (a: PanelAction) => void) =>
			new ContextPanel({ input, onAction: (a) => done(a) }),
		{ overlay: true, overlayOptions: { anchor: "center", width: "95%" } },
	);
	return action;
}

function isCmdCtx(ctx: CtxLike): ctx is CmdCtxLike {
	return typeof (ctx as CmdCtxLike).navigateTree === "function";
}

export async function executePanelAction(
	pi: PiLike,
	ctx: CtxLike,
	action: PanelAction | undefined,
	deps: Deps,
): Promise<void> {
	if (!action || action.type === "close") return;
	if (!isCmdCtx(ctx)) {
		ctx.ui.notify("this action needs a command context — run /panel (Ctrl+T is view-only in 0.79.1)", "warning");
		return;
	}
	switch (action.type) {
		case "jump": {
			const nav = await ctx.navigateTree(action.entryId, { summarize: false });
			if (!nav.cancelled) ctx.ui.notify(`jumped — context now ends at ${action.entryId}`, "info");
			return;
		}
		case "branch": {
			if (action.entryId !== leafIdOf(ctx)) {
				const nav = await ctx.navigateTree(action.entryId, { summarize: false });
				if (nav.cancelled) return;
			}
			const name = await ctx.ui.input("branch name", "fix-flaky-test");
			if (!name?.trim()) return;
			const model = await ctx.ui.input("branch model (empty = keep current)", "");
			await branchHandler(pi, ctx, `${name.trim()}${model?.trim() ? ` ${model.trim()}` : ""}`);
			return;
		}
		case "merge": {
			const { mergeHandler } = await import("./merge.ts");
			await mergeHandler(pi, ctx, "", deps);
			return;
		}
		case "crop-apply": {
			const { applyCropPlan, cropHandler } = await import("./crop-cmd.ts");
			if (action.dryRun) {
				ctx.ui.notify(`(dry-run) would crop ${action.plan.stubs.length} — nothing written`, "info");
				return;
			}
			await applyCropPlan(pi, ctx, action.plan);
			return;
		}
	}
}

export function registerPanel(pi: PiLike, deps: Deps): void {
	pi.registerCommand("panel", {
		description: "pi-context-tree: full-screen context panel (tree · crop · consumers · decisions)",
		handler: async (_args, ctx) => {
			const action = await openPanel(pi, ctx, {});
			await executePanelAction(pi, ctx, action, deps);
		},
	});
	pi.registerShortcut?.("ctrl+t", {
		description: "pi-context-tree: open the context panel",
		handler: async (ctx) => {
			const action = await openPanel(pi, ctx, {});
			await executePanelAction(pi, ctx, action, deps);
		},
	});
	pi.registerCommand("decisions", {
		description: "pi-context-tree: decision records on the current trunk (F7)",
		handler: async (_args, ctx) => {
			const action = await openPanel(pi, ctx, { initialView: "decisions" });
			await executePanelAction(pi, ctx, action, deps);
		},
	});
}
