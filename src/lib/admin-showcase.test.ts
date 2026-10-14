import { describe, expect, test } from "vitest";
import type { Id } from "../../convex/_generated/dataModel";
import type {
	AdminShowcase,
	AdminShowcaseMember,
} from "../../convex/showcases";
import {
	describeChanges,
	draftFromRow,
	fromDateTimeLocal,
	showcaseStatusLabel,
	toDateTimeLocal,
	visibilitySummary,
} from "./admin-showcase";

const NOW = Date.UTC(2026, 9, 17, 4, 0, 0);
const DAY = 24 * 60 * 60 * 1000;

function member(
	slug: string,
	extra: Partial<AdminShowcaseMember> = {},
): AdminShowcaseMember {
	return {
		retailerId: `r_${slug}` as Id<"retailers">,
		slug,
		storeName: `Store ${slug}`,
		country: "MY",
		orderingPaused: false,
		createdAt: NOW - DAY,
		offersDelivery: true,
		notListed: null,
		...extra,
	};
}

function row(extra: Partial<AdminShowcase> = {}): AdminShowcase {
	return {
		_id: "sc_1" as Id<"marketplaceShowcases">,
		slug: "campfest-2026",
		title: "Malaysia Campfest 2026",
		country: "MY",
		theme: "campfire",
		sortOrder: 1,
		state: "draft",
		members: [member("a", { label: "Booth B4" }), member("b")],
		createdAt: NOW - DAY,
		updatedAt: NOW - DAY,
		...extra,
	};
}

describe("showcaseStatusLabel", () => {
	test("live counts down in days, ends today on the last day", () => {
		expect(
			showcaseStatusLabel({ state: "live", endsAt: NOW + 2 * DAY }, NOW).label,
		).toBe("Live · ends in 2 days");
		expect(
			showcaseStatusLabel({ state: "live", endsAt: NOW + 3600_000 }, NOW).label,
		).toBe("Live · ends today");
		expect(showcaseStatusLabel({ state: "live" }, NOW)).toEqual({
			label: "Live",
			tone: "live",
		});
	});
	test("scheduled names the start; draft says buyers can't see it", () => {
		expect(
			showcaseStatusLabel(
				{ state: "scheduled", startsAt: Date.UTC(2026, 10, 1, -8) },
				NOW,
			).label,
		).toBe("Scheduled · starts 1 Nov");
		expect(showcaseStatusLabel({ state: "draft" }, NOW).label).toMatch(
			/Draft · buyers can't see it/,
		);
	});
});

describe("describeChanges — the save bar names what is unsaved", () => {
	test("nothing changed: nothing to say (and Save stays disabled)", () => {
		const r = row();
		expect(describeChanges(draftFromRow(r), r)).toEqual([]);
	});
	test("whitespace-only edits are not changes (the server collapses them)", () => {
		const r = row();
		const d = draftFromRow(r);
		d.title = "  Malaysia   Campfest 2026 ";
		expect(describeChanges(d, r)).toEqual([]);
	});
	test("field edits are named", () => {
		const r = row();
		const d = {
			...draftFromRow(r),
			theme: "ocean" as const,
			endsAt: NOW + DAY,
		};
		expect(describeChanges(d, r)).toEqual(["theme", "dates"]);
	});
	test("member adds, removes, relabels and reorders are named separately", () => {
		const r = row();
		const base = draftFromRow(r);
		expect(
			describeChanges(
				{
					...base,
					members: [
						...base.members,
						{ retailerId: "r_c" as Id<"retailers">, label: "" },
					],
				},
				r,
			),
		).toEqual(["1 store added"]);
		expect(
			describeChanges({ ...base, members: base.members.slice(1) }, r),
		).toEqual(["1 store removed"]);
		expect(
			describeChanges(
				{ ...base, members: [base.members[1], base.members[0]] },
				r,
			),
		).toEqual(["store order"]);
		expect(
			describeChanges(
				{
					...base,
					members: base.members.map((m, i) =>
						i === 1 ? { ...m, label: "Booth C1" } : m,
					),
				},
				r,
			),
		).toEqual(["1 booth label"]);
	});
});

describe("datetime-local round trip", () => {
	test("an epoch survives the picker and back; blank is undefined", () => {
		const epoch = new Date(2026, 9, 18, 23, 59).getTime();
		expect(fromDateTimeLocal(toDateTimeLocal(epoch))).toBe(epoch);
		expect(toDateTimeLocal(undefined)).toBe("");
		expect(fromDateTimeLocal("")).toBeUndefined();
		expect(fromDateTimeLocal("not a date")).toBeUndefined();
	});
});

describe("visibilitySummary", () => {
	test("counts the stores buyers will see", () => {
		expect(visibilitySummary([])).toBe("No stores yet.");
		expect(visibilitySummary([member("a")])).toBe(
			"All 1 store shows to buyers.",
		);
		expect(
			visibilitySummary([member("a"), member("b", { notListed: "opted_out" })]),
		).toBe("1 of 2 stores show to buyers.");
	});
});
