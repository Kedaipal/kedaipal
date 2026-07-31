import { describe, expect, test } from "vitest";
import {
	BUCKET_STATUSES,
	isUnseenOrder,
	orderBucket,
	formatStatusAge,
	statusAgeMs,
	statusAgeSeverity,
	statusToBucket,
} from "./orderBuckets";

const H = 3_600_000;

describe("order buckets", () => {
	test("every status maps to exactly one bucket, consistent with BUCKET_STATUSES", () => {
		for (const [bucket, statuses] of Object.entries(BUCKET_STATUSES)) {
			for (const s of statuses) expect(statusToBucket(s)).toBe(bucket);
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
