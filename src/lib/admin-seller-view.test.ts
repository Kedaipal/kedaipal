// The admin seller directory's view-model (z8r3fdh37c): what "expires" reads
// as per state, why a status is what it is, the chip buckets, the sorts, the
// search, the Copy-summary text and the CSV — all pure, all pinned here so the
// table, cards, sheet and export can't drift apart.
import { describe, expect, it } from "vitest";
import type { AdminSellerRow } from "../../convex/admin";
import {
	countSellerBuckets,
	daysFromNow,
	describeDays,
	filterSellers,
	formatDeadline,
	isEnterpriseLead,
	isSellerFilter,
	isSellerSort,
	matchesSellerSearch,
	SELLER_FILTERS,
	sellerBucket,
	sellerCompMenuItem,
	sellerCredits,
	sellerExpiry,
	sellerFilterEmptyNoun,
	sellerPlanLabel,
	sellerRail,
	sellerReason,
	sellerSeatsLabel,
	sellerSeatsPhrase,
	sellerSummaryText,
	sellersToCsv,
	sellerUnmeteredNote,
	sortSellers,
} from "./admin-seller-view";
import { formatShortDate } from "./format";

const DAY = 24 * 60 * 60 * 1000;
// A fixed "now": 22 Sep 2026, noon local.
const NOW = new Date(2026, 8, 22, 12).getTime();
const at = (days: number) => NOW + days * DAY;

function row(overrides: Partial<AdminSellerRow> = {}): AdminSellerRow {
	return {
		_id: "r1" as AdminSellerRow["_id"],
		storeName: "Bearcamp Malaysia",
		slug: "bearcamp-malaysia",
		ownerUserId: "u1",
		ownerIsAdmin: false,
		seats: { active: 1, cap: 3, capUnlimited: false, invited: 0 },
		isFoundingMember: false,
		foundingIntent: false,
		comped: false,
		createdAt: at(-180),
		unclaimed: false,
		purging: false,
		marketplace: { internal: false },
		country: "MY",
		currency: "MYR",
		billingCurrency: "MYR",
		...overrides,
	};
}

describe("sellerBucket / counts", () => {
	it("admin and comped outrank the raw status; no subscription is its own bucket", () => {
		expect(
			sellerBucket(row({ ownerIsAdmin: true, subscriptionStatus: "past_due" })),
		).toBe("admin");
		expect(
			sellerBucket(row({ comped: true, subscriptionStatus: "active" })),
		).toBe("comped");
		expect(sellerBucket(row({ subscriptionStatus: "on_hold" }))).toBe(
			"on_hold",
		);
		expect(sellerBucket(row())).toBe("none");
	});

	it("counts every bucket plus All, and Past due sits first after All", () => {
		const counts = countSellerBuckets([
			row({ subscriptionStatus: "past_due" }),
			row({ subscriptionStatus: "past_due" }),
			row({ subscriptionStatus: "active" }),
			row({ ownerIsAdmin: true }),
		]);
		expect(counts.all).toBe(4);
		expect(counts.past_due).toBe(2);
		expect(counts.active).toBe(1);
		expect(counts.admin).toBe(1);
		expect(counts.trialing).toBe(0);
		expect(SELLER_FILTERS.slice(0, 2)).toEqual(["all", "past_due"]);
	});

	it("Wants Enterprise is a predicate over the buckets, not a bucket — and sits in the owes-action front group", () => {
		// A trialing store can want Enterprise; the lead filter must not steal
		// the row from its status bucket, and a store already on a contract
		// never counts however stale a stamp it carries.
		const lead = row({
			subscriptionStatus: "trialing",
			enterpriseInterestAt: 1,
		});
		const contracted = row({
			subscriptionStatus: "active",
			plan: "enterprise",
			enterpriseInterestAt: 1,
			enterprise: {
				baseFeeMinor: 88_800,
				currency: "MYR",
				includedCredits: 1500,
				overageRateMinor: 60,
				blockSize: 5000,
				contactName: "HSL",
				setAt: 0,
			},
		});
		expect(isEnterpriseLead(lead)).toBe(true);
		expect(isEnterpriseLead(contracted)).toBe(false);
		const counts = countSellerBuckets([lead, contracted]);
		expect(counts.wants_enterprise).toBe(1);
		expect(counts.trialing).toBe(1); // the lead still counts in its bucket
		expect(filterSellers([lead, contracted], "wants_enterprise", "")).toEqual([
			lead,
		]);
		// Owes-action group order: All, Past due, Unclaimed, then the leads.
		expect(SELLER_FILTERS.slice(0, 4)).toEqual([
			"all",
			"past_due",
			"unclaimed",
			"wants_enterprise",
		]);
		// And its empty state is a sentence, not a lowercased chip label.
		expect(sellerFilterEmptyNoun("wants_enterprise")).toBe(
			"open Enterprise asks",
		);
		expect(sellerFilterEmptyNoun("past_due")).toBe("past due sellers");
	});

	it("validates URL values", () => {
		expect(isSellerFilter("past_due")).toBe(true);
		expect(isSellerFilter("bogus")).toBe(false);
		expect(isSellerSort("expiry")).toBe(true);
		expect(isSellerSort(42)).toBe(false);
	});
});

describe("formatDeadline", () => {
	it("drops the year inside the current year and keeps it across the boundary", () => {
		expect(formatDeadline(at(22), NOW)).toBe(
			formatShortDate(at(22)).replace(/,? ?2026/, ""),
		);
		expect(formatDeadline(at(161), NOW)).toBe(formatShortDate(at(161)));
		expect(formatDeadline(at(161), NOW)).toContain("2027");
	});
});

describe("describeDays", () => {
	it("rounds to whole days and names what a past date means", () => {
		expect(daysFromNow(at(5.5), NOW)).toBe(6);
		expect(describeDays(at(6), NOW)).toBe("in 6 days");
		expect(describeDays(at(1), NOW)).toBe("in 1 day");
		expect(describeDays(NOW + 1000, NOW)).toBe("today");
		expect(describeDays(at(-19), NOW, "overdue")).toBe("19 days overdue");
		expect(describeDays(at(-21), NOW, "locked")).toBe("21 days locked");
		expect(describeDays(at(-52), NOW)).toBe("52 days ago");
	});

	it("a PAST date never claims a day that has not finished (z8r3fdg3mh)", () => {
		// 10 days and 21 hours overdue is TEN days overdue — the calendar says
		// so, and the seller's recovery email says so. Rounding made this
		// console answer 11 and disagree with the email about one invoice.
		expect(daysFromNow(at(-10.875), NOW)).toBe(-10);
		expect(describeDays(at(-10.875), NOW, "overdue")).toBe("10 days overdue");
		// Just past the due moment is not yet a whole day overdue.
		expect(describeDays(at(-0.5), NOW, "overdue")).toBe("today");
		// A future date still rounds — "in 6 days" for 5.5 is how people talk.
		expect(daysFromNow(at(5.5), NOW)).toBe(6);
		expect(daysFromNow(at(5.4), NOW)).toBe(5);
	});
});

describe("sellerExpiry — the wording follows the state", () => {
	it("active renews at the period end; amber inside a week", () => {
		const far = sellerExpiry(
			row({ subscriptionStatus: "active", currentPeriodEnd: at(22) }),
			NOW,
		);
		expect(far).toMatchObject({
			headline: `Renews ${formatDeadline(at(22), NOW)}`,
			detail: "in 22 days",
			tone: "muted",
			at: at(22),
		});
		const soon = sellerExpiry(
			row({ subscriptionStatus: "active", currentPeriodEnd: at(3) }),
			NOW,
		);
		expect(soon.tone).toBe("warn");
	});

	it("trialing ends at the backstop until the first invoice exists, then the invoice's due date is the deadline", () => {
		const free = sellerExpiry(
			row({ subscriptionStatus: "trialing", trialEndsAt: at(6) }),
			NOW,
		);
		expect(free).toMatchObject({
			headline: `Trial ends ${formatDeadline(at(6), NOW)}`,
			detail: "in 6 days",
			tone: "warn",
		});
		const billed = sellerExpiry(
			row({
				subscriptionStatus: "trialing",
				trialEndsAt: at(-2),
				freePeriodEndedAt: at(-3),
				pendingInvoice: {
					invoiceNumber: "KP-0150",
					dueDate: at(4),
					total: 9900,
					currency: "MYR",
					hasPayNowLink: true,
					plan: "pro",
					billingCycle: "monthly",
					kind: "plan",
				},
			}),
			NOW,
		);
		expect(billed).toMatchObject({
			headline: `Invoice due ${formatDeadline(at(4), NOW)}`,
			detail: "in 4 days",
			tone: "warn",
			at: at(4),
		});
	});

	it("past due: the open bill outranks the comp-off explanation, and each says why in days", () => {
		const bill = sellerExpiry(
			row({
				subscriptionStatus: "past_due",
				compEnded: { at: at(-30) },
				pendingInvoice: {
					invoiceNumber: "KP-0142",
					dueDate: at(-19),
					total: 9900,
					currency: "MYR",
					hasPayNowLink: false,
					plan: "pro",
					billingCycle: "monthly",
					kind: "plan",
				},
			}),
			NOW,
		);
		expect(bill).toMatchObject({
			headline: `Was due ${formatDeadline(at(-19), NOW)}`,
			detail: "19 days overdue",
			tone: "danger",
		});
		const comp = sellerExpiry(
			row({ subscriptionStatus: "past_due", compEnded: { at: at(-21) } }),
			NOW,
		);
		expect(comp).toMatchObject({
			headline: `Comp off ${formatDeadline(at(-21), NOW)}`,
			detail: "21 days locked",
			tone: "danger",
		});
		expect(
			sellerExpiry(row({ subscriptionStatus: "past_due" }), NOW),
		).toMatchObject({
			headline: "Past due",
			detail: "No open invoice",
			tone: "danger",
		});
	});

	it("on hold renews the hold; cancelled says when it ended; comped and admin have no date", () => {
		expect(
			sellerExpiry(
				row({
					subscriptionStatus: "on_hold",
					currentPeriodEnd: at(9),
					heldAt: at(-35),
				}),
				NOW,
			),
		).toMatchObject({
			headline: `Hold renews ${formatDeadline(at(9), NOW)}`,
			detail: "in 9 days",
		});
		expect(
			sellerExpiry(
				row({ subscriptionStatus: "cancelled", cancelledAt: at(-52) }),
				NOW,
			),
		).toMatchObject({
			headline: `Ended ${formatDeadline(at(-52), NOW)}`,
			detail: "52 days ago",
			tone: "muted",
		});
		expect(
			sellerExpiry(
				row({ comped: true, comp: { kind: "sponsor", grantedAt: at(-80) } }),
				NOW,
			),
		).toMatchObject({
			headline: "No expiry",
			detail: `Comped since ${formatShortDate(at(-80))}`,
		});
		expect(sellerExpiry(row({ ownerIsAdmin: true }), NOW)).toMatchObject({
			headline: "—",
			detail: "Never billed",
		});
		expect(sellerExpiry(row(), NOW)).toMatchObject({
			headline: "—",
			detail: "No subscription",
		});
		expect(sellerExpiry(row({ ownerIsAdmin: true }), NOW).at).toBeUndefined();
	});
});

describe("sellerReason / plan / rail", () => {
	it("names the open invoice, the comp-off, a failing card, or the hold — and nothing when the pill says it all", () => {
		expect(
			sellerReason(
				row({
					subscriptionStatus: "past_due",
					pendingInvoice: {
						invoiceNumber: "KP-0142",
						dueDate: at(-19),
						total: 1,
						currency: "MYR",
						hasPayNowLink: false,
						plan: "pro",
						billingCycle: "monthly",
						kind: "plan",
					},
				}),
			),
		).toBe("KP-0142 unpaid");
		expect(
			sellerReason(
				row({ subscriptionStatus: "past_due", compEnded: { at: at(-21) } }),
			),
		).toBe("Comp upgrade turned off");
		expect(
			sellerReason(
				row({
					subscriptionStatus: "past_due",
					autoRenew: {
						method: "card",
						attachedAt: 0,
						failedAttempts: 2,
						nextRetryAt: at(2),
					},
				}),
			),
		).toBe(`Auto-renew failed ×2 · retry ${formatShortDate(at(2))}`);
		expect(
			sellerReason(row({ subscriptionStatus: "on_hold", heldAt: at(-35) })),
		).toBe(`Off-season since ${formatShortDate(at(-35))}`);
		expect(sellerReason(row({ subscriptionStatus: "active" }))).toBeUndefined();
		expect(
			sellerReason(row({ comped: true, subscriptionStatus: "past_due" })),
		).toBeUndefined();
	});

	it("plan and rail read as cycle · how money arrives", () => {
		expect(sellerPlanLabel(row({ plan: "pro" }))).toBe("Pro");
		expect(sellerPlanLabel(row({ ownerIsAdmin: true, plan: "pro" }))).toBe("—");
		expect(
			sellerRail(
				row({
					subscriptionStatus: "active",
					billingCycle: "monthly",
					autoRenew: {
						method: "card",
						methodLabel: "Visa ·· 4242",
						attachedAt: 0,
					},
				}),
			),
		).toBe("Monthly · auto-renew Visa ·· 4242");
		expect(
			sellerRail(
				row({
					subscriptionStatus: "active",
					billingCycle: "annual",
					pendingInvoice: {
						invoiceNumber: "x",
						dueDate: 0,
						total: 1,
						currency: "MYR",
						hasPayNowLink: true,
						plan: "pro",
						billingCycle: "monthly",
						kind: "plan",
					},
				}),
			),
		).toBe("Annual · Pay-now link");
		expect(
			sellerRail(
				row({ subscriptionStatus: "trialing", billingCycle: "monthly" }),
			),
		).toBe("Monthly · free period");
		expect(
			sellerRail(
				row({ subscriptionStatus: "on_hold", billingCycle: "monthly" }),
			),
		).toBe("Monthly · held");
		expect(
			sellerRail(
				row({ subscriptionStatus: "active", billingCycle: "monthly" }),
			),
		).toBe("Monthly · manual billing");
		expect(
			sellerRail(
				row({
					comped: true,
					comp: { kind: "sponsor", label: "Maybank SME", grantedAt: 0 },
				}),
			),
		).toBe("Sponsor · Maybank SME");
		expect(sellerRail(row({ ownerIsAdmin: true }))).toBe("Admin store");
	});
});

describe("search + filter", () => {
	const rows = [
		row({
			storeName: "Bearcamp Malaysia",
			slug: "bearcamp-malaysia",
			ownerEmail: "hello@bearcamp.example",
			waPhone: "60123456789",
			subscriptionStatus: "active",
		}),
		row({
			_id: "r2" as AdminSellerRow["_id"],
			storeName: "Kuih Mak Su",
			slug: "kuih-mak-su",
			notifyWaPhone: "60187654321",
			subscriptionStatus: "cancelled",
		}),
	];

	it("matches name, slug, email, and phone digits however typed", () => {
		expect(matchesSellerSearch(rows[0], "BEAR")).toBe(true);
		expect(matchesSellerSearch(rows[0], "bearcamp-mal")).toBe(true);
		expect(matchesSellerSearch(rows[0], "hello@")).toBe(true);
		expect(matchesSellerSearch(rows[0], "+60 12-345")).toBe(true);
		expect(matchesSellerSearch(rows[1], "018-7")).toBe(true); // local form, alerts number
		expect(matchesSellerSearch(rows[1], "6018")).toBe(true);
		expect(matchesSellerSearch(rows[1], "0199")).toBe(false);
		expect(matchesSellerSearch(rows[0], "12")).toBe(false); // too short to match a phone
		expect(matchesSellerSearch(rows[0], "   ")).toBe(true);
	});

	it("filters by bucket and search together", () => {
		expect(filterSellers(rows, "all", "").map((r) => r.slug)).toEqual([
			"bearcamp-malaysia",
			"kuih-mak-su",
		]);
		expect(filterSellers(rows, "cancelled", "").map((r) => r.slug)).toEqual([
			"kuih-mak-su",
		]);
		expect(filterSellers(rows, "active", "kuih")).toEqual([]);
	});
});

describe("sortSellers", () => {
	const a = row({
		_id: "a" as AdminSellerRow["_id"],
		storeName: "Zed",
		foundingMemberRank: 2,
		createdAt: at(-10),
		subscriptionStatus: "active",
		currentPeriodEnd: at(30),
	});
	const b = row({
		_id: "b" as AdminSellerRow["_id"],
		storeName: "Alpha",
		createdAt: at(-1),
		subscriptionStatus: "trialing",
		trialEndsAt: at(3),
	});
	const c = row({
		_id: "c" as AdminSellerRow["_id"],
		storeName: "Mid",
		foundingMemberRank: 1,
		createdAt: at(-50),
		ownerIsAdmin: true,
	});

	it("founding rank first then newest; expiry soonest with dateless rows last; newest; name", () => {
		expect(
			sortSellers([a, b, c], "founding", NOW).map((r) => r.storeName),
		).toEqual(["Mid", "Zed", "Alpha"]);
		expect(
			sortSellers([a, b, c], "expiry", NOW).map((r) => r.storeName),
		).toEqual(["Alpha", "Zed", "Mid"]);
		expect(
			sortSellers([a, b, c], "newest", NOW).map((r) => r.storeName),
		).toEqual(["Alpha", "Zed", "Mid"]);
		expect(sortSellers([a, b, c], "name", NOW).map((r) => r.storeName)).toEqual(
			["Alpha", "Mid", "Zed"],
		);
	});

	it("never mutates the input", () => {
		const input = [a, b, c];
		sortSellers(input, "name", NOW);
		expect(input.map((r) => r.storeName)).toEqual(["Zed", "Alpha", "Mid"]);
	});
});

describe("sellerSummaryText + CSV", () => {
	const full = row({
		ownerEmail: "hello@bearcamp.example",
		waPhone: "60123456789",
		plan: "pro",
		billingCycle: "monthly",
		subscriptionStatus: "active",
		currentPeriodEnd: at(22),
		autoRenew: { method: "card", methodLabel: "Visa ·· 4242", attachedAt: 0 },
		foundingMemberRank: 1,
	});

	it("writes the block an admin pastes into WhatsApp, with absent facts named", () => {
		expect(sellerSummaryText(full, "https://kedaipal.com", NOW)).toBe(
			[
				"Bearcamp Malaysia — https://kedaipal.com/bearcamp-malaysia",
				"Email: hello@bearcamp.example",
				"WhatsApp: +60 12-345 6789",
				"Plan: Pro · Monthly · auto-renew Visa ·· 4242 · Active",
				"Seats: 1/3",
				// No credit account on this fixture — said, not left blank.
				"Credits: No credit account yet",
				`Renews ${formatDeadline(at(22), NOW)} · in 22 days`,
			].join("\n"),
		);
		expect(sellerSummaryText(row(), "https://kedaipal.com", NOW)).toContain(
			"Email: none on file",
		);
		expect(sellerSummaryText(row(), "https://kedaipal.com", NOW)).toContain(
			"WhatsApp: none on file",
		);
	});

	it("exports one row per seller with a header, phones as stored digits and dates sortable", () => {
		const csv = sellersToCsv([full], "https://kedaipal.com", NOW);
		const [header, line] = csv.split("\r\n");
		expect(header.split(",")).toContain("Store WhatsApp");
		expect(line).toContain(
			"Bearcamp Malaysia,bearcamp-malaysia,https://kedaipal.com/bearcamp-malaysia,Active,,Pro,",
		);
		expect(line).toContain("60123456789");
		expect(line).toMatch(/,\d{4}-\d{2}-\d{2},/);
	});
});

describe("a pre-built store reads as unclaimed everywhere (docs/prebuilt-stores.md)", () => {
	const waiting = row({
		unclaimed: true,
		pendingOwnerEmail: "vendor@example.com",
		// A pre-built store always carries the `internal` setup comp — the whole
		// point of these cases is that it must not read as a sponsored deal.
		comped: true,
		comp: { kind: "internal", grantedAt: at(-3) },
		subscriptionStatus: "active",
	});
	const nameless = row({
		unclaimed: true,
		comped: true,
		comp: { kind: "internal", grantedAt: at(-3) },
	});

	it("outranks comped and admin in the chip — a half-built store is never filed under Comped", () => {
		expect(sellerBucket(waiting)).toBe("unclaimed");
		expect(sellerBucket(row({ unclaimed: true, ownerIsAdmin: true }))).toBe(
			"unclaimed",
		);
		expect(countSellerBuckets([waiting, row()]).unclaimed).toBe(1);
	});

	it("sits straight after Past due — both are buckets where WE owe an action", () => {
		expect(SELLER_FILTERS.slice(0, 3)).toEqual([
			"all",
			"past_due",
			"unclaimed",
		]);
	});

	it("filters to only the unclaimed rows", () => {
		expect(
			filterSellers([waiting, row(), nameless], "unclaimed", "").map(
				(r) => r.unclaimed,
			),
		).toEqual([true, true]);
	});

	it("shows no clock — the trial starts at handover, so no date on the row is about the vendor", () => {
		const e = sellerExpiry(waiting, NOW);
		expect(e.headline).toBe("Not handed over");
		expect(e.detail).toBe("Waiting for vendor@example.com");
		expect(e.at).toBeUndefined();
		// Not the comped reading, which would say "No expiry · Comped since …"
		// and look like a sponsorship.
		expect(e.headline).not.toBe("No expiry");
	});

	it("goes amber when nobody is named — a store built and then abandoned is unfinished work", () => {
		expect(sellerExpiry(nameless, NOW)).toMatchObject({
			headline: "Not handed over",
			detail: "No handover email yet",
			tone: "warn",
		});
		expect(sellerExpiry(waiting, NOW).tone).toBe("muted");
	});

	it("says why, and never names a billing rail that cannot move money", () => {
		expect(sellerReason(waiting)).toBe("Built by us · waiting to be claimed");
		expect(sellerReason(nameless)).toBe("Built by us · set a handover email");
		expect(sellerRail(waiting)).toBe("Not billed until claimed");
	});

	it("is found by the HANDOVER email — the only address a pre-built store has", () => {
		expect(matchesSellerSearch(waiting, "vendor@example.com")).toBe(true);
		expect(matchesSellerSearch(waiting, "vendor")).toBe(true);
		// And the search still only matches the row it belongs to.
		expect(matchesSellerSearch(row(), "vendor@example.com")).toBe(false);
	});

	it("Copy summary states 'unclaimed' rather than 'none on file'", () => {
		const text = sellerSummaryText(waiting, "https://kedaipal.com", NOW);
		expect(text).toContain("Owner: unclaimed · waiting for vendor@example.com");
		// Not the owner-email line at all — "Email: none on file" would read as a
		// seller who cleared theirs. (The WhatsApp line still says "none on
		// file", correctly: the store genuinely has no number yet.)
		expect(text).not.toContain("Email: none on file");
		expect(sellerSummaryText(nameless, "https://kedaipal.com", NOW)).toContain(
			"no handover email yet",
		);
	});

	it("exports the handover email and the claim date as their own columns", () => {
		const csv = sellersToCsv(
			[waiting, row({ claimedAt: at(-2), ownerEmail: "owner@example.com" })],
			"https://kedaipal.com",
			NOW,
		);
		const [header, first, second] = csv.split("\n");
		expect(header).toContain("Handover email");
		expect(header).toContain("Claimed");
		expect(first).toContain("vendor@example.com");
		// A claimed store carries its handover DATE but no pending address.
		expect(second).toContain("owner@example.com");
	});

	it("counts nobody, because there is nobody — not '1/3 seats' against an empty store", () => {
		// Caught by RENDERING the directory card, not by reading the code: the
		// owner is an implicit +1 in `listSellersForAdmin`, and an unclaimed
		// store has no owner to count.
		// The COLUMN value is short — it lands under a "Seats" header in a cell
		// sized for "1/3", where "No team yet" wrapped to three lines.
		expect(sellerSeatsLabel(waiting)).toBe("None");
		expect(sellerSeatsLabel(row())).toBe("1/3");
		// The card inlines it in prose and used to append the noun itself, which
		// read "No one yet seats" — found by rendering the card, not by reading.
		expect(sellerSeatsPhrase(waiting)).toBe("No team yet");
		expect(sellerSeatsPhrase(row())).toBe("1/3 seats");
		expect(sellerSummaryText(waiting, "https://kedaipal.com", NOW)).toContain(
			"Seats: None",
		);
	});

	it("the Manage menu calls the setup comp what it is, not a sponsorship", () => {
		// A pre-built store is ALWAYS comped — the `internal` comp keeps it
		// unbilled while an admin builds it — so the ordinary comped copy
		// described that scaffolding as a sponsorship and offered to turn it
		// off. Same lie the Sponsored pill told, on the surface that still
		// believed it (found by opening the menu, 2 Oct).
		const item = sellerCompMenuItem(waiting);
		expect(item.title).toBe("Comp upgrade — setup only");
		expect(item.hint).toMatch(/ends when they claim it/i);
		expect(item.hint).not.toMatch(/sponsorship/i);
		// Muted, not violet: violet is the live-sponsorship colour.
		expect(item.sponsored).toBe(false);
	});

	it("but a REAL comp on an unclaimed store keeps the sponsorship copy", () => {
		// Pre-comping a partner ahead of handover is supported and survives the
		// claim (startFreePeriodOnClaim), so it must not be relabelled as setup.
		const partner = row({
			unclaimed: true,
			comped: true,
			comp: { kind: "partner", grantedAt: at(-1) },
		});
		const item = sellerCompMenuItem(partner);
		expect(item.title).toBe("Comp upgrade — on");
		expect(item.hint).toMatch(/sponsorship/i);
		expect(item.sponsored).toBe(true);
	});

	it("a contract store's comp item carries the refusal the menu disables on", () => {
		// The menu greys the item for an Enterprise store (`setComp` refuses a
		// comp over a contract, T6) — this subtitle is where that refusal is
		// SAID, so the constraint is surfaced, never silent.
		const item = sellerCompMenuItem(
			row({
				plan: "enterprise",
				enterprise: {
					baseFeeMinor: 88_800,
					currency: "MYR",
					includedCredits: 1500,
					overageRateMinor: 60,
					blockSize: 5000,
					contactName: "HSL Food GM",
					setAt: at(-1),
				},
			}),
		);
		expect(item.hint).toBe("On an Enterprise contract — move it to Pro first");
		expect(item.sponsored).toBe(false);
	});

	it("an ordinary comped store and an admin store are untouched", () => {
		expect(sellerCompMenuItem(row({ comped: true }))).toMatchObject({
			title: "Comp upgrade — on",
			sponsored: true,
		});
		expect(sellerCompMenuItem(row())).toMatchObject({
			title: "Turn on comp upgrade",
			sponsored: false,
		});
		expect(sellerCompMenuItem(row({ ownerIsAdmin: true }))).toMatchObject({
			hint: "Admin store — always free already",
		});
	});

	it("once claimed it reads like any other seller again", () => {
		const claimed = row({
			unclaimed: false,
			claimedAt: at(-2),
			subscriptionStatus: "trialing",
			trialEndsAt: at(12),
		});
		expect(sellerBucket(claimed)).toBe("trialing");
		expect(sellerReason(claimed)).toBeUndefined();
		expect(sellerExpiry(claimed, NOW).headline).not.toBe("Not handed over");
	});
});

describe("sellerCredits", () => {
	const credits = {
		plan: 180,
		purchased: 20,
		periodKey: "2026-10",
		periodGrant: 200,
	};

	it("an admin's own store reads as not metered, whatever figures it still holds", () => {
		// z8r3fdp4er: unmetered stores leave their old cached balances behind
		// until the purge runs — printing "200 left" for one would be a credit
		// state that nothing in the product honours any more.
		const view = sellerCredits(row({ ownerIsAdmin: true, credits }));
		expect(view.headline).toBe("—");
		expect(view.detail).toBe("Admin store — not metered");
		expect(view.out).toBe(false);
		expect(view.total).toBeUndefined();
		// What the sheet reads to drop "This month", "Out of credits" and
		// "Custom grant" — rows that would print the stale cache.
		expect(view.metered).toBe(false);
	});

	it("a metered store reads its balance", () => {
		expect(sellerCredits(row({ credits })).headline).toBe("200 left");
		expect(sellerCredits(row({ credits })).metered).toBe(true);
		expect(sellerCredits(row()).metered).toBe(true);
	});

	it("a SPONSORED store reads 'not metered', never its stale cache (z8r3fdrph7)", () => {
		// The row keeps whatever figures it carried while it was billed — the
		// directory printing "plan 200 · bought 0" beside a comp is the admin
		// console repeating the very "200" the seller's meter no longer shows.
		const comped = sellerCredits(row({ comped: true, credits }));
		expect(comped.metered).toBe(false);
		expect(comped.headline).toBe("—");
		expect(comped.detail).toBe("Sponsored — not metered");
		expect(comped.tone).toBe("muted");
		expect(comped.out).toBe(false);
		// An admin's own store is told apart from it: the next step differs,
		// since a comp is a toggle and an admin store is permanent.
		expect(sellerCredits(row({ ownerIsAdmin: true, credits })).detail).toBe(
			"Admin store — not metered",
		);
	});

	it("the unmetered note names WHICH kind — a comp's next state is 'metered again'", () => {
		expect(sellerUnmeteredNote(row({ ownerIsAdmin: true }))).toMatch(
			/^Admin store — not metered/,
		);
		const sponsored = sellerUnmeteredNote(row({ comped: true }));
		expect(sponsored).toMatch(/^Sponsored store — not metered/);
		expect(sponsored).toMatch(/metered again/);
	});

	it("a store with no account yet says so", () => {
		expect(sellerCredits(row()).detail).toBe("No credit account yet");
	});
});
