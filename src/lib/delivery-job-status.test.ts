import { describe, expect, it } from "vitest";
import { jobStatusLabel, jobStatusTone } from "./delivery-job-status";

const rider = { provider: "lalamove" as const, collection: false };

describe("jobStatusLabel", () => {
	it("speaks rider for Lalamove and courier for Delyva", () => {
		expect(jobStatusLabel("assigning", rider)).toBe("Finding rider");
		expect(
			jobStatusLabel("assigning", { provider: "delyva", collection: false }),
		).toBe("Booked");
	});
	it("a collection trip arrives rather than delivers", () => {
		expect(
			jobStatusLabel("completed", { provider: "lalamove", collection: true }),
		).toBe("Arrived");
		expect(jobStatusLabel("completed", rider)).toBe("Delivered");
	});
	it("names every failure in words, never the raw status", () => {
		expect(jobStatusLabel("canceled", rider)).toBe("Cancelled");
		expect(jobStatusTone("rejected")).toBe("failed");
		expect(jobStatusTone("ongoing")).toBe("active");
	});

	it("a returned parcel is never Delivered, and a flagged booking says it was never scanned (z8r3fe11y8)", () => {
		const courier = { provider: "delyva" as const, collection: false };
		expect(jobStatusLabel("completed", { ...courier, returned: true })).toBe(
			"Returned",
		);
		expect(jobStatusTone("completed", { returned: true })).toBe("warn");
		expect(jobStatusLabel("assigning", { ...courier, stale: true })).toBe(
			"Not scanned yet",
		);
		expect(jobStatusTone("ongoing", { stale: true })).toBe("warn");
		// The flags mean nothing on any other status.
		expect(jobStatusLabel("picked_up", { ...courier, stale: true })).toBe(
			"In transit",
		);
		expect(jobStatusTone("rejected", { returned: true })).toBe("failed");
		expect(jobStatusLabel("completed", courier)).toBe("Delivered");
	});
});
