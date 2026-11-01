import { describe, expect, test } from "vitest";
import {
	ACTIVE_JOB_STATUSES,
	type DeliveryJobStatus,
	isActiveJobStatus,
	TERMINAL_JOB_STATUSES,
} from "./deliveryJobs";

// Every status the union knows. A new member must be added here AND to
// exactly one of the two sets, or the index-walking reads
// (`lalamoveRiderOutBlock`) silently stop seeing it.
const ALL_STATUSES: readonly DeliveryJobStatus[] = [
	"assigning",
	"ongoing",
	"picked_up",
	"completed",
	"canceled",
	"expired",
	"rejected",
];

describe("deliveryJobs status sets", () => {
	test("every status is active or terminal, never both, never neither", () => {
		for (const status of ALL_STATUSES) {
			const active = ACTIVE_JOB_STATUSES.includes(
				status as (typeof ACTIVE_JOB_STATUSES)[number],
			);
			const terminal = TERMINAL_JOB_STATUSES.has(status);
			expect(active !== terminal, status).toBe(true);
			expect(isActiveJobStatus(status)).toBe(active);
		}
		expect(ACTIVE_JOB_STATUSES.length + TERMINAL_JOB_STATUSES.size).toBe(
			ALL_STATUSES.length,
		);
	});
});
