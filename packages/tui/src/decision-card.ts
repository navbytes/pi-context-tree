/**
 * ◆ decision-record card (mockup dcard): pretty rendering for ctree/decision
 * custom messages in pi's chat, registered via pi.registerMessageRenderer.
 * Collapsed: title · meta · outcome · epitaphs. Expanded: full record body.
 * Epitaphs stay visible either way — they are the G3 guard.
 */

import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { type CtreeTheme, defaultTheme } from "./theme.ts";

export interface DecisionCardInput {
	branchName?: string;
	dateIso?: string;
	content: string;
	siblings?: { name: string; reason: string }[];
	expanded: boolean;
}

export function decisionCardLines(input: DecisionCardInput, width: number, theme: CtreeTheme = defaultTheme): string[] {
	const t = theme;
	const name = input.branchName ?? "decision";
	const lines: string[] = [];
	lines.push(`${t.decision("◆")} ${t.decision(name)} ${t.dim("— decision record (squash-merged branch)")}`);
	lines.push(t.dim(`  ${input.dateIso ?? ""}${input.dateIso ? " · " : ""}human-confirmed ✓`));

	const body = input.content.split("\n");
	if (input.expanded) {
		for (const line of body) lines.push(`  ${line}`);
	} else {
		const outcome = body.find((l) => l.startsWith("**Outcome:**"));
		lines.push(`  ${outcome ?? body[0] ?? ""}`);
		lines.push(t.dim("  (expand to see the full record)"));
	}
	for (const s of input.siblings ?? []) {
		lines.push(`  ${t.presentation.rejected(`✗ ${s.name} — ${s.reason}`)}`);
	}
	return lines.map((l) => (visibleWidth(l) > width ? truncateToWidth(l, width, "…") : l));
}
