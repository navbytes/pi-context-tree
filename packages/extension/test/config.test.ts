import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { getGaugeMode, setConfigPath, setGaugeMode } from "../src/config.ts";

const dir = mkdtempSync(join(tmpdir(), "ctree-config-"));
const cfg = join(dir, "pi-context-tree.json");
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("gauge mode config", () => {
	beforeEach(() => {
		rmSync(cfg, { force: true });
		setConfigPath(cfg); // also drops the cache
	});

	it("defaults to bar when the file is missing", () => {
		expect(getGaugeMode()).toBe("bar");
	});

	it("defaults to bar on invalid JSON or an unknown value", () => {
		writeFileSync(cfg, "{ not json");
		setConfigPath(cfg);
		expect(getGaugeMode()).toBe("bar");
		writeFileSync(cfg, JSON.stringify({ gauge: "sideways" }));
		setConfigPath(cfg);
		expect(getGaugeMode()).toBe("bar");
	});

	it("round-trips set + get", () => {
		setGaugeMode("border");
		expect(getGaugeMode()).toBe("border");
		setGaugeMode("bar");
		expect(getGaugeMode()).toBe("bar");
	});

	it("preserves other keys in the file (read-modify-write)", () => {
		writeFileSync(cfg, JSON.stringify({ other: 1, nested: { keep: true } }));
		setConfigPath(cfg);
		setGaugeMode("border");
		expect(JSON.parse(readFileSync(cfg, "utf8"))).toEqual({ other: 1, nested: { keep: true }, gauge: "border" });
	});

	it("starts fresh on invalid JSON instead of throwing", () => {
		writeFileSync(cfg, "{ not json");
		setConfigPath(cfg);
		setGaugeMode("border");
		expect(getGaugeMode()).toBe("border");
	});

	it("caches the seam path — refreshAmbient runs this every turn", () => {
		setGaugeMode("border");
		expect(getGaugeMode()).toBe("border");
		// an edit behind the cache is not observed until something invalidates it
		writeFileSync(cfg, JSON.stringify({ gauge: "bar" }));
		expect(getGaugeMode()).toBe("border");
		setConfigPath(cfg);
		expect(getGaugeMode()).toBe("bar");
	});

	it("writes through the cache so /gauge takes effect immediately", () => {
		expect(getGaugeMode()).toBe("bar"); // prime it
		setGaugeMode("border");
		expect(getGaugeMode()).toBe("border");
	});

	it("an explicit path bypasses both the seam and the cache", () => {
		const other = join(dir, "other.json");
		setGaugeMode("border", other);
		expect(getGaugeMode(other)).toBe("border");
		expect(getGaugeMode()).toBe("bar"); // seam path untouched
	});
});
