// @vitest-environment jsdom
// Setup-checklist stamps must NO-OP while an admin is acting-as.
//
// The three mutations behind them take no arguments and resolve the store from
// the CALLER's identity, so fired from an act-as session they stamp the ADMIN'S
// OWN store rather than the seller's. The server cannot defend itself (an admin
// sharing their own link is legitimate), so this is the guard — and it used to
// be five hand-written copies in two spellings, three of which were missing.

import fs from "node:fs";
import path from "node:path";
import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

const stamp = vi.fn(async () => undefined);
vi.mock("convex/react", () => ({ useMutation: () => stamp }));

const actAs = { id: undefined as string | undefined };
vi.mock("./useActAs", () => ({
	useActAsRetailerId: () => actAs.id,
}));

const { useChecklistStamp } = await import("./useChecklistStamp");

// biome-ignore lint/suspicious/noExplicitAny: a stand-in for the mutation ref.
const REF = {} as any;

afterEach(() => {
	stamp.mockClear();
	actAs.id = undefined;
});

describe("useChecklistStamp", () => {
	test("stamps normally when the seller is operating their own store", async () => {
		const { result } = renderHook(() => useChecklistStamp(REF));
		await result.current.stamp();
		expect(stamp).toHaveBeenCalledWith({});
	});

	test("does NOTHING while an admin is acting-as", async () => {
		// The bug this exists for: the stamp would land on the admin's own store.
		actAs.id = "retailer_being_built_for_a_vendor";
		const { result } = renderHook(() => useChecklistStamp(REF));
		await result.current.stamp();
		expect(stamp).not.toHaveBeenCalled();
	});

	test("REPORTS that it is inert, so an awaiting caller can disable its control", async () => {
		// A silent no-op is fine fire-and-forget and a trap for a caller that
		// sequences UI on the promise — the greeting row hung on "Saving…"
		// waiting for a flip that was never coming (PR review, 2 Oct).
		const live = renderHook(() => useChecklistStamp(REF));
		expect(live.result.current.active).toBe(true);
		actAs.id = "retailer_being_built_for_a_vendor";
		const inert = renderHook(() => useChecklistStamp(REF));
		expect(inert.result.current.active).toBe(false);
	});

	test("still resolves when it no-ops, because a caller awaits it", async () => {
		// The greeting row sequences its saving state on this promise; a guard
		// that returned early without resolving would hang that row forever.
		actAs.id = "retailer_being_built_for_a_vendor";
		const { result } = renderHook(() => useChecklistStamp(REF));
		await expect(result.current.stamp()).resolves.toBeUndefined();
	});
});

describe("no call site bypasses the hook", () => {
	test("the three checklist mutations are only ever reached through it", () => {
		// A gate, not a style check. Every one of these stamps is zero-arg and
		// identity-resolved, so a direct `useMutation` on one is a write aimed at
		// the wrong store the moment an admin is acting-as. Three of five call
		// sites had already made exactly that mistake, which is why remembering
		// is not good enough.
		const MUTATIONS = [
			"markLinkShared",
			"markPickupSetupSeen",
			"markGreetingSetupDone",
		];
		const root = path.join(process.cwd(), "src");
		const offenders: string[] = [];
		const walk = (dir: string) => {
			for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
				const full = path.join(dir, entry.name);
				if (entry.isDirectory()) {
					walk(full);
					continue;
				}
				if (!/\.tsx?$/.test(entry.name)) continue;
				if (entry.name.includes(".test.")) continue;
				const src = fs.readFileSync(full, "utf8");
				for (const m of MUTATIONS) {
					if (src.includes(`useMutation(api.retailers.${m})`)) {
						offenders.push(`${path.relative(root, full)} → ${m}`);
					}
				}
			}
		};
		walk(root);
		expect(offenders).toEqual([]);
	});
});
