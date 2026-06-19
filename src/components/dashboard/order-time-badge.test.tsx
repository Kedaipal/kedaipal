// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { OrderTimeBadge } from "./order-time-badge";

afterEach(cleanup);
const H = 3_600_000;
const NOW = 1_000_000_000;

describe("OrderTimeBadge", () => {
	it("escalates a long-pending order (amber after 4h)", () => {
		render(
			<OrderTimeBadge
				order={{ status: "pending", statusChangedAt: NOW - 5 * H, createdAt: 0 }}
				now={NOW}
			/>,
		);
		expect(screen.getByText("5h").className).toMatch(/amber/);
	});

	it("shows non-pending ages in a neutral tone", () => {
		render(
			<OrderTimeBadge
				order={{
					status: "confirmed",
					statusChangedAt: NOW - 50 * H,
					createdAt: 0,
				}}
				now={NOW}
			/>,
		);
		const el = screen.getByText("2d");
		expect(el.className).not.toMatch(/amber|red/);
	});
});
