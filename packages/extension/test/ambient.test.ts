import { beforeEach, describe, expect, it } from "vitest";
import { refreshAmbient, resetAmbient } from "../src/ambient.ts";
import { makeFake } from "./fake-pi.ts";

// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping ANSI is the point
const STRIP = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");

describe("refreshAmbient", () => {
	beforeEach(resetAmbient); // clear the trend baseline between tests

	it("shows branch and banded percentage from pi usage", () => {
		const w = makeFake();
		w.session.user("hi");
		w.session.assistant("hello");
		w.ctx.getContextUsage = () => ({ tokens: 30_000, contextWindow: 200_000, percent: 15 });
		refreshAmbient(w.pi, w.ctx);
		expect(w.ui.statuses.get("ctree")).toBe("⎇ trunk · ctx 15.0% filling");
	});

	it("estimates honestly (band + est, no fake percent) when pi reports zero usage", () => {
		const w = makeFake();
		w.session.user("hi");
		w.session.assistant("x".repeat(40_000)); // ~10k tokens ≈ 5% of 200k
		w.ctx.getContextUsage = () => ({ tokens: 0, contextWindow: 200_000, percent: 0 });
		refreshAmbient(w.pi, w.ctx);
		const status = w.ui.statuses.get("ctree") ?? "";
		expect(status).toContain("est"); // marked estimated by word, not three sig figs
		expect(status).not.toMatch(/\d\.\d%/); // no fake-precise percent
		expect(status).toMatch(/ctx (healthy|low) · est/);
	});

	it("pins a context-health gauge bar above the prompt (G1)", () => {
		const w = makeFake();
		w.session.user("hi");
		w.ctx.getContextUsage = () => ({ tokens: 30_000, contextWindow: 200_000, percent: 15 });
		refreshAmbient(w.pi, w.ctx);

		const widget = w.ui.widgets.get("ctree-gauge");
		expect(widget?.placement ?? "aboveEditor").toBe("aboveEditor");
		const line = STRIP(widget?.lines?.[0] ?? "");
		expect(line).toContain("CONTEXT"); // the panel gauge, pinned above the prompt
		expect(line).toContain("15.0% filling"); // band-labeled (color verified live; chalk is off in vitest)
	});

	it("estimates honestly in the bar (≈tokens + est, no fake percent)", () => {
		const w = makeFake();
		w.session.user("hi");
		w.session.assistant("x".repeat(40_000));
		w.ctx.getContextUsage = () => ({ tokens: 0, contextWindow: 200_000, percent: 0 });
		refreshAmbient(w.pi, w.ctx);
		const line = STRIP(w.ui.widgets.get("ctree-gauge")?.lines?.[0] ?? "");
		expect(line).toContain("est"); // estimated marker in the gauge label
		expect(line).not.toMatch(/\d\.\d%/); // no fake-precise percent
	});

	it("keeps the estimating state when there is no window to band against", () => {
		const w = makeFake();
		w.session.user("hi");
		w.ctx.getContextUsage = () => undefined;
		const model = w.ctx.model as { contextWindow?: number };
		const saved = model.contextWindow;
		model.contextWindow = undefined;
		refreshAmbient(w.pi, w.ctx);
		expect(w.ui.statuses.get("ctree")).toBe("⎇ trunk · ctx —");
		model.contextWindow = saved;
	});

	it("marks a rising context with a ▲ trend (no attribution under +5 pts)", () => {
		const w = makeFake();
		w.session.user("a");
		w.ctx.getContextUsage = () => ({ tokens: 30_000, contextWindow: 200_000, percent: 15 });
		refreshAmbient(w.pi, w.ctx);
		w.ctx.getContextUsage = () => ({ tokens: 38_000, contextWindow: 200_000, percent: 19 });
		refreshAmbient(w.pi, w.ctx);
		const status = w.ui.statuses.get("ctree") ?? "";
		expect(status).toContain("▲");
		expect(status).not.toContain("+"); // Δ4 → trend only, no jump attribution
	});

	it("attributes a jump to the consumer that grew the most", () => {
		const w = makeFake();
		w.session.user("start");
		w.ctx.getContextUsage = () => ({ tokens: 20_000, contextWindow: 200_000, percent: 10 });
		refreshAmbient(w.pi, w.ctx); // baseline
		w.session.toolResult("chrome.snapshot", "x".repeat(240_000)); // a fat result lands
		w.ctx.getContextUsage = () => ({ tokens: 80_000, contextWindow: 200_000, percent: 40 });
		refreshAmbient(w.pi, w.ctx);
		const status = w.ui.statuses.get("ctree") ?? "";
		expect(status).toContain("▲ +30%"); // 40 − 10
		expect(status).toContain("(chrome.snapshot)");
	});

	it("does not read the estimate→real calibration as a jump", () => {
		const w = makeFake();
		w.session.user("hi");
		w.session.assistant("x".repeat(40_000));
		w.ctx.getContextUsage = () => ({ tokens: 0, contextWindow: 200_000, percent: 0 }); // estimate ~5%
		refreshAmbient(w.pi, w.ctx);
		w.ctx.getContextUsage = () => ({ tokens: 80_000, contextWindow: 200_000, percent: 40 }); // real 40%
		refreshAmbient(w.pi, w.ctx);
		expect(w.ui.statuses.get("ctree") ?? "").not.toContain("▲");
	});
});
