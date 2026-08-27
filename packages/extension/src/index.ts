/**
 * pi-context-tree — pi extension entry point. Load with:
 *   pi -e /path/to/pi-context-tree/packages/extension/src/index.ts
 * or symlink this package into ~/.pi/agent/extensions/ for auto-discovery.
 *
 * Commands: /branch /merge /crop /panel /decisions (+ Ctrl+Q).
 * Pinned against pi 0.84.3 — see pi-context-tree-architecture.md.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { CTREE_DECISION, type CtreeDecisionDetails, textOfContent } from "@pi-context-tree/core";
import { decisionCardLines } from "@pi-context-tree/tui";
import type { Deps, PiLike } from "./adapter.ts";
import { refreshAmbient, registerAmbient } from "./ambient.ts";
import { registerBranch } from "./branch.ts";
import { type GaugeMode, getGaugeMode, setGaugeMode } from "./config.ts";
import { registerCrop } from "./crop-cmd.ts";
import { realDraft } from "./draft.ts";
import { registerMerge } from "./merge.ts";
import { registerPanel } from "./panel-cmd.ts";
import { registerUndo } from "./undo.ts";

export default function piContextTree(api: ExtensionAPI): void {
	// pi's ExtensionAPI is a structural superset of PiLike (verified 0.84.3).
	const pi = api as unknown as PiLike;
	const deps: Deps = { draft: realDraft };

	registerBranch(pi);
	registerMerge(pi, deps);
	registerCrop(pi);
	registerPanel(pi, deps);
	registerUndo(pi);
	registerAmbient(pi);

	// F5.6: where the gauge lives — a widget above the editor, or the input border
	pi.registerCommand("gauge", {
		description: "pi-context-tree: context gauge display — /gauge bar|border",
		handler: async (args, ctx) => {
			const arg = args.trim().toLowerCase();
			if (!arg) {
				ctx.ui.notify(`gauge mode: ${getGaugeMode()} — /gauge bar|border`, "info");
				return;
			}
			if (arg !== "bar" && arg !== "border") {
				ctx.ui.notify(`unknown gauge mode "${arg}" — use /gauge bar|border`, "warning");
				return;
			}
			const mode: GaugeMode = arg;
			try {
				setGaugeMode(mode);
			} catch (e) {
				ctx.ui.notify(`could not save gauge mode: ${e instanceof Error ? e.message : String(e)}`, "error");
				return;
			}
			ctx.ui.notify(`gauge mode: ${mode}`, "info");
			refreshAmbient(pi, ctx);
		},
		getArgumentCompletions: () => [
			{ value: "bar", label: "bar — gauge widget above the editor" },
			{ value: "border", label: "border — the input box border is the gauge" },
		],
	});

	// ◆ decision records render as mockup-style cards in the chat (F7 polish)
	pi.registerMessageRenderer?.<CtreeDecisionDetails>(CTREE_DECISION, (message, options) => ({
		// pi-tui Component requires it; these cards are static, nothing to invalidate
		invalidate: () => {},
		render: (width: number) =>
			decisionCardLines(
				{
					branchName: message.details?.branchName,
					dateIso: message.timestamp ? new Date(message.timestamp).toISOString().slice(0, 10) : undefined,
					content: textOfContent(message.content),
					siblings: message.details?.siblings,
					expanded: options.expanded,
				},
				width,
			),
	}));
}
