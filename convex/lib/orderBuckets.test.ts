import { describe, expect, test } from "vitest";
import {
	BUCKET_STATUSES,
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
