/**
 * Decision Record rendering — spec §6 template, v0.3 (includes Assumptions).
 * The rendered markdown is what lands on the trunk as a ctree/decision
 * custom_message after the human confirm/edit gate.
 */

export interface DecisionDraft {
	branchName: string;
	dateIso: string;
	model: string;
	branchId: string;
	outcome: string;
	why: string[];
	assumptions?: string;
	changes?: string;
	gotchas?: string;
	openQuestions?: string;
	confidence?: string;
	rejected?: { name: string; reason: string }[];
}

export function renderDecisionRecord(d: DecisionDraft): string {
	const lines: string[] = [
		`## Decision: ${d.branchName}`,
		`**Date:** ${d.dateIso} · **Model:** ${d.model} · **Branch:** ${d.branchId}`,
		`**Outcome:** ${d.outcome}`,
		"**Why:**",
		...d.why.map((w) => `- ${w}`),
		`**Assumptions:** ${d.assumptions ?? "—"}`,
		`**Changes:** ${d.changes ?? "none"}`,
		`**Gotchas:** ${d.gotchas ?? "—"}`,
		`**Open questions:** ${d.openQuestions ?? "—"}`,
		`**Confidence / revisit-if:** ${d.confidence ?? "—"}`,
	];
	if (d.rejected?.length) {
		lines.push("### Rejected alternatives");
		for (const r of d.rejected) lines.push(`- **${r.name}:** ${r.reason}`);
	}
	return `${lines.join("\n")}\n`;
}
