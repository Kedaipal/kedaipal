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
});
