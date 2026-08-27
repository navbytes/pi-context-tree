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
		expect(w.ui.statuses.get("ctree")).toBe("⎇ trunk · ctx 15.0% healthy"); // 30k tokens: 15% of the window, but healthy on the token axis
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
		// filling, not healthy: only 5% of the window, but 10k tokens is past the
		// 8k absolute cap — the token axis is the whole point of BAND_TOKENS
		expect(status).toMatch(/ctx healthy · est/); // ~10k tokens — past 8k, well short of 32k
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
		expect(line).toContain("15.0% healthy"); // band-labeled (color verified live; chalk is off in vitest)
		expect(line).not.toMatch(/^\s/); // factory form bypasses pi's Text(line, paddingX=1) wrapper
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

	it("clears the bar when the window goes unknown (no stale number over `ctx —`)", () => {
		const w = makeFake();
		w.session.user("hi");
		w.ctx.getContextUsage = () => ({ tokens: 30_000, contextWindow: 200_000, percent: 15 });
		refreshAmbient(w.pi, w.ctx);
		expect(w.ui.widgets.get("ctree-gauge")?.lines?.[0]).toBeTruthy();

		w.ctx.getContextUsage = () => undefined;
		const model = w.ctx.model as { contextWindow?: number };
		const saved = model.contextWindow;
		model.contextWindow = undefined;
		refreshAmbient(w.pi, w.ctx);
		expect(w.ui.widgets.get("ctree-gauge")?.lines).toBeUndefined();
		model.contextWindow = saved;
	});

	it("nudges once on entering red, and not again while hovering the boundary", () => {
		const w = makeFake();
		w.session.user("hi");
		const reds = () => w.ui.notifications.filter((n) => n.msg.includes("red band")).length;
		const at = (percent: number) => {
			w.ctx.getContextUsage = () => ({ tokens: percent * 2_000, contextWindow: 200_000, percent });
			refreshAmbient(w.pi, w.ctx);
		};

		at(40); // 80k tokens → red
		expect(reds()).toBe(1);
		at(20); // 40k → dip back to filling: normal work, not a new event
		at(40);
		at(20);
		at(40);
		expect(reds()).toBe(1); // hysteresis: no re-arm from one band down
	});

	it("re-arms the nudge after context drops a full band clear of red", () => {
		const w = makeFake();
		w.session.user("hi");
		const reds = () => w.ui.notifications.filter((n) => n.msg.includes("red band")).length;
		const at = (percent: number) => {
			w.ctx.getContextUsage = () => ({ tokens: percent * 2_000, contextWindow: 200_000, percent });
			refreshAmbient(w.pi, w.ctx);
		};

		at(40); // 80k tokens → red
		expect(reds()).toBe(1);
		at(5); // 10k — /crop or /merge actually worked, back to healthy
		at(40); // and it filled up again: that is a new event, worth saying
		expect(reds()).toBe(2);
	});

	it("warns about pi's auto-compaction separately from the quality band", () => {
		const w = makeFake();
		w.session.user("hi");
		const compacts = () => w.ui.notifications.filter((n) => n.msg.includes("auto-compact")).length;

		// 100k of 200k: red on quality, but 100k of headroom — no container warning
		w.ctx.getContextUsage = () => ({ tokens: 100_000, contextWindow: 200_000, percent: 50 });
		refreshAmbient(w.pi, w.ctx);
		expect(w.ui.notifications.some((n) => n.msg.includes("red band"))).toBe(true);
		expect(compacts()).toBe(0);

		// 190k of 200k: inside pi's 16k reserve
		w.ctx.getContextUsage = () => ({ tokens: 190_000, contextWindow: 200_000, percent: 95 });
		refreshAmbient(w.pi, w.ctx);
		expect(compacts()).toBe(1);
		refreshAmbient(w.pi, w.ctx);
		expect(compacts()).toBe(1); // one-time, like the red nudge
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
