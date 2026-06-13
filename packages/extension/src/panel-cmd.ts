/**
 * /panel + Ctrl+Q (F4): the full-screen Context Panel, hosted as a pi overlay
 * via ctx.ui.custom({overlay:true}) — the mechanism verified public in 0.79.1.
 * The panel returns ONE action; mutations execute back here in command context
 * after re-validation (TRD §6).
 */

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
	type CtreeDecisionDetails,
	type PanelAction,
	type PanelInput,
	type PanelView,
	SessionTree,
	decisionsOnPath,
	exportDecisionsMarkdown,
	textOfContent,
} from "@pi-context-tree/core";
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
	// Full-screen overlay (mockup contract): 100% width, body rows sized to the
	// terminal minus panel chrome (header, gauge, dividers, secthead, footer,
	// notify line, scroll hint). 95% width left the chat showing in the margins.
	const PANEL_CHROME_ROWS = 9;
	const action = await ctx.ui.custom<PanelAction>(
		(tui: unknown, _theme: unknown, _keybindings: unknown, done: (a: PanelAction) => void) => {
			const rows = (tui as { terminal?: { rows?: number } } | undefined)?.terminal?.rows;
			const maxBody = Math.max(8, (rows ?? 34) - PANEL_CHROME_ROWS);
			return new ContextPanel({ input, maxBody, onAction: (a) => done(a) });
		},
		{ overlay: true, overlayOptions: { anchor: "center", width: "100%" } },
	);
	return action;
}

function isCmdCtx(ctx: CtxLike): ctx is CmdCtxLike {
	return typeof (ctx as CmdCtxLike).navigateTree === "function";
}

/** /decisions without a TUI host (RPC/headless): compact text listing, newest first. */
function notifyDecisions(ctx: CtxLike): void {
	const entries = entriesOf(ctx);
	const tree = SessionTree.fromEntries(entries);
	const leafId = leafIdOf(ctx) ?? tree.fileLeafId();
	const decs = leafId ? decisionsOnPath(tree, leafId) : [];
	if (decs.length === 0) {
		ctx.ui.notify("no decision records on this trunk yet — /merge → squash creates them (F7)", "info");
		return;
	}
	const lines = [...decs].reverse().map((d) => {
		const det = d.details as CtreeDecisionDetails | undefined;
		const text = textOfContent(d.content);
		const outcome = text.split("\n").find((l) => l.startsWith("**Outcome:**")) ?? text.split("\n")[0] ?? "";
		const date = (d.timestamp ?? "").slice(0, 10);
		return `◆ ${det?.branchName ?? "decision"} (${date}) ${outcome.replace("**Outcome:**", "").trim()}`;
	});
	ctx.ui.notify(lines.join("\n"), "info");
}

/** /decisions --export [path]: write all trunk decision records to portable markdown. */
function exportDecisions(ctx: CtxLike, args: string): void {
	const entries = entriesOf(ctx);
	const tree = SessionTree.fromEntries(entries);
	const leafId = leafIdOf(ctx) ?? tree.fileLeafId();
	const decs = leafId ? decisionsOnPath(tree, leafId) : [];
	const md = exportDecisionsMarkdown(
		decs.map((d) => textOfContent(d.content)),
		projectName(),
	);
	const pathArg = args.replace("--export", "").trim().split(/\s+/).filter(Boolean)[0];
	const outPath = resolve(pathArg || "ctree-decisions.md");
	try {
		writeFileSync(outPath, md, "utf8");
	} catch (err) {
		ctx.ui.notify(`could not write ${outPath}: ${(err as Error).message}`, "error");
		return;
	}
	ctx.ui.notify(`wrote ${decs.length} decision record${decs.length === 1 ? "" : "s"} → ${outPath}`, "info");
}

export async function executePanelAction(
	pi: PiLike,
	ctx: CtxLike,
	action: PanelAction | undefined,
	deps: Deps,
): Promise<void> {
	if (!action || action.type === "close") return;
	if (!isCmdCtx(ctx)) {
		ctx.ui.notify("this action needs a command context — run /panel (Ctrl+Q is view-only in 0.79.1)", "warning");
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

/** Open → act → reopen with fresh state until the user closes (mockup: the panel stays up). */
async function runPanel(pi: PiLike, ctx: CtxLike, deps: Deps, opts: PanelOpenOptions = {}): Promise<void> {
	for (let i = 0; i < 50; i++) {
		const action = await openPanel(pi, ctx, opts);
		if (!action || action.type === "close") return;
		await executePanelAction(pi, ctx, action, deps);
	}
}

export function registerPanel(pi: PiLike, deps: Deps): void {
	pi.registerCommand("panel", {
		description: "pi-context-tree: full-screen context panel (tree · crop · consumers · decisions)",
		handler: (_args, ctx) => runPanel(pi, ctx, deps),
	});
	// ctrl+q, not ctrl+t: pi reserves ctrl+t for app.thinking.toggle (it's in
	// RESERVED_KEYBINDINGS_FOR_EXTENSION_CONFLICTS), so a ctrl+t shortcut is
	// silently skipped. ctrl+q is unbound by pi and deliverable (pi runs the
	// terminal in raw mode, so XON/XOFF flow control can't eat it).
	pi.registerShortcut?.("ctrl+q", {
		description: "pi-context-tree: open the context panel",
		handler: (ctx) => runPanel(pi, ctx, deps),
	});
	pi.registerCommand("decisions", {
		description: "pi-context-tree: decision records on the current trunk (F7) — --export [path] for portable markdown",
		handler: async (args, ctx) => {
			if (args.includes("--export")) {
				exportDecisions(ctx, args);
				return;
			}
			if (!ctx.ui.custom) {
				notifyDecisions(ctx);
				return;
			}
			await runPanel(pi, ctx, deps, { initialView: "decisions" });
		},
		getArgumentCompletions: (prefix) =>
			"--export".startsWith(prefix.split(/\s+/).pop() ?? "") ? [{ value: "--export", label: "--export" }] : null,
	});
}
