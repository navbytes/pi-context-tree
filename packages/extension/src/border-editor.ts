/**
 * Gauge mode "border" (F5.6): install a CustomEditor whose bottom border is the
 * context gauge. Follows pi's own border-status-editor example — subclass
 * CustomEditor, rewrite the border lines in render(), install via
 * ctx.ui.setEditorComponent.
 *
 * All the drawing lives in @pi-context-tree/tui (border-gauge.ts) so it is
 * testable without pi and shares `gaugeLabel()` with the bar. This file is only
 * the wiring.
 *
 * pi re-asserts editor.borderColor for bash/thinking mode — that restyles the
 * DEFAULT editor's border. We emit our own characters and ignore borderColor;
 * host border states are not ours to fight.
 */

import { CustomEditor } from "@earendil-works/pi-coding-agent";
import { defaultTheme, type GaugeInput, paintBorderGauge } from "@pi-context-tree/tui";

/** Latest reading, pushed by ambient on every refresh; render() reads it. */
let current: { input: GaugeInput; trend: string } = { input: { tokens: null }, trend: "" };

export function setBorderGauge(input: GaugeInput, trend: string): void {
	current = { input, trend };
}

/** test seam */
export function resetBorderGauge(): void {
	current = { input: { tokens: null }, trend: "" };
}

// Param types come from CustomEditor itself — pi-coding-agent nests its own
// pi-tui copy, so naming pi-tui's TUI/EditorTheme directly fails tsc here.
type EditorArgs = ConstructorParameters<typeof CustomEditor>;

class BorderGaugeEditor extends CustomEditor {
	render(width: number): string[] {
		return paintBorderGauge(super.render(width), current.input, defaultTheme, current.trend, width);
	}
}

/** Factory for ctx.ui.setEditorComponent. Stable identity — ambient compares it. */
export function createBorderGaugeFactory(): (...args: EditorArgs) => CustomEditor {
	return (tui, theme, keybindings) => new BorderGaugeEditor(tui, theme, keybindings);
}
