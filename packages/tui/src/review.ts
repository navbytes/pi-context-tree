/**
 * SummaryReview — non-modal confirm gate for LLM-drafted records (#33 flow 1).
 * Shows the draft in a full-screen overlay with the stats that make review
 * meaningful; the editor opens only on demand. One action closes the overlay:
 * accept · edit · regenerate · cancel. The host owns what each action does —
 * this component never writes anything.
 *
 * pi-tui contract: render(width) returns lines that must not exceed width;
 * input arrives via handleInput when focused (Focusable).
 */

import { matchesKey, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { fmtTokens } from "@pi-context-tree/core";
import { type CtreeTheme, defaultTheme } from "./theme.ts";

export interface ReviewAction {
	type: "accept" | "edit" | "regenerate" | "cancel";
}

export interface SummaryReviewOptions {
	/** branch whose record is under review (header context) */
	branchName: string;
	/** the drafted record text, shown verbatim (wrapped to width) */
	draft: string;
	/** entries the merge will close — the blast radius of accepting */
	entryCount: number;
	/** estimated tokens of the branch being summarized */
	estTokens: number;
	/** model that drafted the record */
	model?: string;
	/** whether the r key is offered (false for --no-llm templates) */
	regenerable?: boolean;
	onAction: (action: ReviewAction) => void;
	theme?: CtreeTheme;
	/** body rows shown at once (scroll window) */
	maxBody?: number;
}

/** greedy word wrap; long unbroken words are hard-split at the limit */
export function wrapText(text: string, width: number): string[] {
	const out: string[] = [];
	for (const raw of text.split("\n")) {
		if (raw.length <= width) {
			out.push(raw);
			continue;
		}
		let line = "";
		for (const word of raw.split(" ")) {
			let w = word;
			while (w.length > width) {
				if (line) {
					out.push(line);
					line = "";
				}
				out.push(w.slice(0, width));
				w = w.slice(width);
			}
			if (!line) line = w;
			else if (line.length + 1 + w.length <= width) line = `${line} ${w}`;
			else {
				out.push(line);
				line = w;
			}
		}
		out.push(line);
	}
	return out;
}

export class SummaryReview {
	focused = false;
	private readonly opts: SummaryReviewOptions;
	private readonly theme: CtreeTheme;
	private scroll = 0;

	constructor(opts: SummaryReviewOptions) {
		this.opts = opts;
		this.theme = opts.theme ?? defaultTheme;
	}

	/** pi-tui Component requires it; this component re-renders from the vm each frame */
	invalidate(): void {}

	handleInput(data: string): void {
		if (matchesKey(data, "enter")) {
			this.opts.onAction({ type: "accept" });
			return;
		}
		if (matchesKey(data, "escape")) {
			this.opts.onAction({ type: "cancel" });
			return;
		}
		if (data === "e") {
			this.opts.onAction({ type: "edit" });
			return;
		}
		if (data === "r" && this.opts.regenerable) {
			this.opts.onAction({ type: "regenerate" });
			return;
		}
		if (matchesKey(data, "down") || data === "j") this.scroll += 1;
		if (matchesKey(data, "up") || data === "k") this.scroll = Math.max(0, this.scroll - 1);
	}

	render(width: number): string[] {
		const t = this.theme;
		const lines: string[] = [];
		const model = this.opts.model ? t.dim(` · drafted by ${this.opts.model}`) : "";
		lines.push(
			` ${t.brand("pi-context-tree")} ${t.dim("· review")}  ${t.presentation.active(`⎇ ${this.opts.branchName}`)}${t.dim(
				` · closes ${this.opts.entryCount} entries · ~${fmtTokens(this.opts.estTokens)} tok`,
			)}${model}`,
		);
		lines.push(t.dim("─".repeat(Math.max(0, width))));

		const body = wrapText(this.opts.draft, Math.max(20, width - 2));
		const maxBody = this.opts.maxBody ?? 24;
		this.scroll = Math.max(0, Math.min(this.scroll, Math.max(0, body.length - maxBody)));
		const visible = body.slice(this.scroll, this.scroll + maxBody);
		for (const line of visible) lines.push(` ${line}`);
		// constant body height so the overlay never shifts by a row while scrolling
		for (let i = visible.length; i < maxBody; i++) lines.push("");
		lines.push(
			body.length > this.scroll + maxBody
				? t.dim(` … ${body.length - this.scroll - maxBody} more (j/k to scroll)`)
				: "",
		);

		lines.push(t.dim("─".repeat(Math.max(0, width))));
		const redraft = this.opts.regenerable ? " · r re-draft" : "";
		lines.push(` ${t.dim(`enter accept · e edit in editor${redraft} · esc cancel · j/k scroll`)}`);
		return lines.map((l) => (visibleWidth(l) > width ? truncateToWidth(l, width, "…") : l));
	}
}
