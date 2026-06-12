/**
 * ContextPanel — the full-screen panel component (F4). Renders a PanelVm and
 * forwards its actions to the host. Runs identically inside pi (mounted via
 * ctx.ui.custom overlay) and standalone (pitree ui, read-only).
 *
 * pi-tui contract: render(width) returns lines that must not exceed width;
 * input arrives via handleInput when focused (Focusable).
 */

import { matchesKey, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { type PanelAction, type PanelInput, type PanelRow, PanelVm, fmtTokens } from "@pi-context-tree/core";
import { renderGauge } from "./gauge.ts";
import { type CtreeTheme, defaultTheme } from "./theme.ts";

export interface ContextPanelOptions {
	input: PanelInput;
	onAction: (action: PanelAction) => void;
	onNotify?: (message: string) => void;
	theme?: CtreeTheme;
	/** body rows shown at once (scroll window) */
	maxBody?: number;
}

const TOKEN_COL = 9;

export class ContextPanel {
	focused = false;
	private readonly vm: PanelVm;
	private readonly theme: CtreeTheme;
	private readonly opts: ContextPanelOptions;
	private scroll = 0;
	private lastNotify: string | undefined;

	constructor(opts: ContextPanelOptions) {
		this.opts = opts;
		this.vm = new PanelVm(opts.input);
		this.theme = opts.theme ?? defaultTheme;
	}

	/** exposed for tests and hosts */
	get viewModel(): PanelVm {
		return this.vm;
	}

	handleInput(data: string): void {
		const key = this.mapKey(data);
		if (!key) return;
		const effect = this.vm.handleKey(key);
		if (effect.notify) {
			this.lastNotify = effect.notify;
			this.opts.onNotify?.(effect.notify);
		} else if (key !== "j" && key !== "k" && key !== "up" && key !== "down") {
			this.lastNotify = undefined;
		}
		if (effect.action) this.opts.onAction(effect.action);
	}

	private mapKey(data: string): string | undefined {
		if (matchesKey(data, "up")) return "up";
		if (matchesKey(data, "down")) return "down";
		if (matchesKey(data, "left")) return "left";
		if (matchesKey(data, "right")) return "right";
		if (matchesKey(data, "enter")) return "enter";
		if (matchesKey(data, "escape")) return "esc";
		if (matchesKey(data, "space")) return "space";
		if (data.length === 1 && data >= " " && data <= "~") return data;
		return undefined;
	}

	render(width: number): string[] {
		const t = this.theme;
		const h = this.vm.header();
		const lines: string[] = [];

		const ro = h.readOnly ? t.warn(" READ-ONLY ") : "";
		const session = h.sessionName ? ` · ${h.sessionName}` : "";
		lines.push(
			` ${t.brand("pi-context-tree")} ${t.dim(`· ${h.view}`)}  ${h.project}${t.dim(session)} ${t.presentation.active(`⎇ ${h.branchName}`)}${h.model ? t.dim(` · ${h.model}`) : ""}${ro}`,
		);
		lines.push(
			` ${renderGauge({ tokens: h.tokens, window: h.window, estimated: h.estimated, barWidth: Math.min(30, Math.max(10, width - 50)) }, t)}`,
		);
		lines.push(t.dim("─".repeat(Math.max(0, width))));
		const sect = this.vm.sectionTitle();
		if (sect) lines.push(` ${t.dim(sect)}`);

		const rows = this.vm.rows();
		const maxBody = this.opts.maxBody ?? 26;
		if (this.vm.sel < this.scroll) this.scroll = this.vm.sel;
		if (this.vm.sel >= this.scroll + maxBody) this.scroll = this.vm.sel - maxBody + 1;
		this.scroll = Math.max(0, Math.min(this.scroll, Math.max(0, rows.length - maxBody)));

		const visible = rows.slice(this.scroll, this.scroll + maxBody);
		visible.forEach((row, i) => {
			lines.push(this.renderRow(row, this.scroll + i === this.vm.sel, width));
		});
		if (rows.length > this.scroll + maxBody) {
			lines.push(t.dim(` … ${rows.length - this.scroll - maxBody} more (${this.vm.sel + 1}/${rows.length})`));
		}

		lines.push(t.dim("─".repeat(Math.max(0, width))));
		if (this.lastNotify) lines.push(` ${t.warn(this.lastNotify)}`);
		lines.push(` ${t.dim(this.vm.footerHelp())}`);

		return lines.map((l) => (visibleWidth(l) > width ? truncateToWidth(l, width, "…") : l));
	}

	private renderRow(row: PanelRow, selected: boolean, width: number): string {
		const t = this.theme;
		const indent = "  ".repeat(Math.min(row.depth, 12));

		let left: string;
		switch (row.kind) {
			case "fork": {
				const color = t.presentation[row.presentation ?? "active"];
				const fold = row.foldable ? (row.folded ? " [+]" : " [-]") : "";
				left = `${indent}${color("⎇")} ${color(row.forkName ?? "")} ${t.dim(row.text.replace(`${row.forkName} · `, "· "))}${t.dim(fold)}`;
				break;
			}
			case "crop": {
				const mark = row.marked ? t.mark("[✗]") : row.protected ? t.dim("[⊘]") : t.dim("[ ]");
				const age = t.dim(`${String(row.age ?? 0).padStart(3)}t`);
				const prot = row.protected && !row.marked ? t.dim(" (latest — protected)") : "";
				const armed = row.armed ? t.warn(" ⚠ space again to override") : "";
				left = `${indent}${mark} ${row.text}${prot}${armed} ${age}`;
				break;
			}
			case "consumer": {
				const barLen = Math.max(1, Math.min(30, Math.round(((row.tokens ?? 0) / 1000) * 2)));
				left = `${indent}${row.text.padEnd(40)} ${t.warn("▰".repeat(barLen))}`;
				break;
			}
			case "decision": {
				const glyph =
					row.glyph === "✗"
						? t.presentation.rejected(row.glyph)
						: row.glyph === "◆"
							? t.decision(row.glyph)
							: row.glyph;
				const text = row.dim ? t.dim(row.text) : row.glyph === "✗" ? t.presentation.rejected(row.text) : row.text;
				left = `${indent}${glyph} ${text}`;
				break;
			}
			default: {
				const glyph = row.glyph === "◆" ? t.decision(row.glyph) : row.dim ? t.dim(row.glyph) : t.dim(row.glyph);
				const text = row.dim ? t.dim(row.text) : row.text;
				const leaf = row.current ? t.leaf(" ◀ leaf") : "";
				left = `${indent}${glyph} ${text}${leaf}`;
			}
		}

		const warn = row.warn ? t.warn(" ⚠") : "";
		const tokens =
			row.tokens === undefined
				? t.dim("·".padStart(TOKEN_COL))
				: (row.tokens >= 10_000 ? t.warn : row.tokens >= 1000 ? t.tokensBig : t.dim)(
						fmtTokens(row.tokens).padStart(TOKEN_COL),
					);

		const leftBudget = Math.max(8, width - TOKEN_COL - 3 - (row.warn ? 2 : 0));
		const leftFit = visibleWidth(left) > leftBudget ? truncateToWidth(left, leftBudget, "…") : left;
		const pad = " ".repeat(Math.max(1, leftBudget - visibleWidth(leftFit)));
		const line = ` ${leftFit}${pad}${tokens}${warn}`;
		return selected ? this.theme.sel(line) : line;
	}
}
