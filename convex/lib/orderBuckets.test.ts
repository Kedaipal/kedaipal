import { describe, expect, test } from "vitest";
import {
	BUCKET_LEAVES,
	foldLegacyBuckets,
	formatStatusAge,
	INBOX_LEAF_KEYS,
	type InboxStatusLeaf,
	isUnseenOrder,
	leafBucket,
	leafLabel,
	orderBucket,
	orderLeaf,
	statusAgeMs,
	statusAgeSeverity,
	statusToBucket,
} from "./orderBuckets";

const H = 3_600_000;

describe("order buckets", () => {
	test("every status maps to exactly one bucket, consistent with BUCKET_LEAVES", () => {
		for (const [bucket, leaves] of Object.entries(BUCKET_LEAVES)) {
			for (const leaf of leaves) expect(leafBucket(leaf)).toBe(bucket);
		}
		// In-progress spans the three middle statuses.
		expect(statusToBucket("confirmed")).toBe("in_progress");
		expect(statusToBucket("packed")).toBe("in_progress");
		expect(statusToBucket("shipped")).toBe("in_progress");
		expect(statusToBucket("pending")).toBe("new");
		expect(statusToBucket("delivered")).toBe("completed");
		expect(statusToBucket("cancelled")).toBe("cancelled");
	});
});

describe("status leaves — the one filterable atom", () => {
	// THE property the whole 1-Sep change rests on: a bucket is exactly the union
	// of its leaves, so the chip row (groups) and the filter panel (leaves) are
	// two grains of ONE state and their counts sum. If this drifts, a bucket chip
	// starts advertising a total its own rows don't add up to — the bug class the
	// leaf model replaced.
	test("BUCKET_LEAVES partitions INBOX_LEAF_KEYS exactly", () => {
		const flat = Object.values(BUCKET_LEAVES).flat();
		expect(flat.slice().sort()).toEqual([...INBOX_LEAF_KEYS].sort());
		expect(new Set(flat).size).toBe(flat.length);
	});

	// The leaf set must keep covering every real status, or a status added later
	// becomes silently unfilterable — exactly how `booking_requested` ended up
	// unreachable from the panel.
	test("every leaf but the unseen split is a real OrderStatus", () => {
		const statusLeaves = INBOX_LEAF_KEYS.filter((l) => l !== "confirmed_unseen");
		for (const leaf of statusLeaves) {
			expect(leafBucket(leaf)).toBe(statusToBucket(leaf));
		}
		expect(statusLeaves).toHaveLength(7);
	});

	test("orderLeaf splits confirmed by seen-state; orderBucket agrees", () => {
		const unseen = {
			status: "confirmed" as const,
			confirmationPushStatus: "sent",
		};
		expect(orderLeaf(unseen)).toBe("confirmed_unseen");
		expect(orderBucket(unseen)).toBe("new");
		expect(isUnseenOrder(unseen)).toBe(true);

		// Opened — same status, different leaf, different bucket.
		const seen = { ...unseen, seenAt: 1 };
		expect(orderLeaf(seen)).toBe("confirmed");
		expect(orderBucket(seen)).toBe("in_progress");

		// A counter sale is born confirmed but never carries the push flag.
		const counter = { status: "confirmed" as const };
		expect(orderLeaf(counter)).toBe("confirmed");
		expect(orderBucket(counter)).toBe("in_progress");
	});

	test("the unseen leaf is not renameable — it never asks the resolver", () => {
		const shout = (st: string) => `RENAMED_${st}`;
		expect(leafLabel("confirmed_unseen", shout)).toBe("Not yet opened");
		expect(leafLabel("packed", shout)).toBe("RENAMED_packed");
	});
});

describe("foldLegacyBuckets — pre-1-Sep clients and bookmarks", () => {
	test("a bucket alone becomes its leaves", () => {
		expect(foldLegacyBuckets(["new"], undefined)).toEqual([
			"pending",
			"booking_requested",
			"confirmed_unseen",
		]);
	});

	test("no bucket leaves the leaf set untouched", () => {
		const st: InboxStatusLeaf[] = ["packed"];
		expect(foldLegacyBuckets(undefined, st)).toEqual(st);
		expect(foldLegacyBuckets([], st)).toEqual(st);
		expect(foldLegacyBuckets(undefined, undefined)).toBeUndefined();
	});

	test("the old AND is preserved as an intersection", () => {
		// "In progress" chip + "Packed" ticked used to mean packed-only.
		expect(foldLegacyBuckets(["in_progress"], ["packed"])).toEqual(["packed"]);
	});

	test("a contradictory pair falls back to the panel's own selection, never to everything", () => {
		// It used to show an empty list. An empty array here would read as "no
		// status filter" and hand back the WHOLE inbox — the one outcome worse
		// than either reading.
		const out = foldLegacyBuckets(["new"], ["packed"]);
		expect(out).toEqual(["packed"]);
		expect(out).not.toHaveLength(0);
	});
});

describe("time in status", () => {
	test("statusAgeMs prefers statusChangedAt, then updatedAt, then createdAt", () => {
		const now = 1_000_000;
		expect(
			statusAgeMs(
				{ statusChangedAt: now - 5000, updatedAt: now - 9999, createdAt: 0 },
				now,
			),
		).toBe(5000);
		// Legacy order (no statusChangedAt) falls back to updatedAt.
		expect(statusAgeMs({ updatedAt: now - 7000, createdAt: 0 }, now)).toBe(7000);
		// Then createdAt.
		expect(statusAgeMs({ createdAt: now - 8000 }, now)).toBe(8000);
		// Never negative.
		expect(statusAgeMs({ statusChangedAt: now + 1000, createdAt: 0 }, now)).toBe(
			0,
		);
	});

	test("formatStatusAge is compact", () => {
		expect(formatStatusAge(0)).toBe("just now");
		expect(formatStatusAge(5 * 60_000)).toBe("5m");
		expect(formatStatusAge(2 * H)).toBe("2h");
		expect(formatStatusAge(3 * 24 * H)).toBe("3d");
	});

	test("only pending escalates (amber >4h, red >24h)", () => {
		expect(statusAgeSeverity("pending", 1 * H)).toBe("normal");
		expect(statusAgeSeverity("pending", 5 * H)).toBe("warn");
		expect(statusAgeSeverity("pending", 25 * H)).toBe("urgent");
		// Other statuses stay neutral regardless of age.
		expect(statusAgeSeverity("confirmed", 100 * H)).toBe("normal");
		expect(statusAgeSeverity("delivered", 100 * H)).toBe("normal");
	});
});

describe("unseen push-path orders (86eyf1rck)", () => {
	const unseenPush = {
		status: "confirmed" as const,
		confirmationPushStatus: "sent",
	};

	test("a confirmed push-path order the seller hasn't opened counts as New", () => {
		expect(isUnseenOrder(unseenPush)).toBe(true);
		expect(orderBucket(unseenPush)).toBe("new");
	});

	test("opening it moves it to In progress — exactly one bucket, never both", () => {
		const seen = { ...unseenPush, seenAt: 1_700_000_000_000 };
		expect(isUnseenOrder(seen)).toBe(false);
		expect(orderBucket(seen)).toBe("in_progress");
	});

	test("legacy confirmed orders are untouched, so no backfill floods the New bucket", () => {
		// No confirmationPushStatus => this order never skipped `pending`.
		const legacy = { status: "confirmed" as const };
		expect(isUnseenOrder(legacy)).toBe(false);
		expect(orderBucket(legacy)).toBe("in_progress");
	});

	test("a failed push still shows as New — that's the one the seller most needs", () => {
		expect(
			orderBucket({ status: "confirmed", confirmationPushStatus: "failed" }),
		).toBe("new");
	});

	test("later statuses are never dragged back to New by an unseen stamp", () => {
		for (const status of ["packed", "shipped", "delivered", "cancelled"] as const) {
			expect(orderBucket({ status, confirmationPushStatus: "sent" })).toBe(
				statusToBucket(status),
			);
		}
	});

	test("pending still buckets as New on the legacy flow", () => {
		expect(orderBucket({ status: "pending" })).toBe("new");
	});

	test("age escalation follows the risk window onto unseen orders", () => {
		// The pending-based overload is unchanged for legacy callers.
		expect(statusAgeSeverity("pending", 5 * H)).toBe("warn");
		// An unseen push-path order escalates the same way…
		expect(statusAgeSeverity(unseenPush, 5 * H)).toBe("warn");
		expect(statusAgeSeverity(unseenPush, 25 * H)).toBe("urgent");
		// …and stops the moment the seller opens it.
		expect(
			statusAgeSeverity({ ...unseenPush, seenAt: 1 }, 25 * H),
		).toBe("normal");
	});
});
