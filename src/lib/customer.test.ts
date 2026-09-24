import { describe, expect, test } from "vitest";
import * as server from "../../convex/lib/customer";
import { formatPhone, getDisplayName, orderCustomerLabel } from "./customer";

// The behaviour is tested once, beside its author (`convex/lib/customer.test.ts`).
// What this pins is that the dashboard renders through THAT code — a hand copy
// creeping back in would fork the seller's screen from the PDFs and the server.
describe("dashboard customer helpers", () => {
	test("are the server's own functions, not a mirror", () => {
		expect(formatPhone).toBe(server.formatPhone);
		expect(getDisplayName).toBe(server.getDisplayName);
		expect(orderCustomerLabel).toBe(server.orderCustomerLabel);
	});
});
