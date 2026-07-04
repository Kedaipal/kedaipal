// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useRevealOnAdd } from "./useRevealOnAdd";

afterEach(cleanup);

// jsdom doesn't implement scrollIntoView — stub it so the hook can call it.
beforeEach(() => {
	Element.prototype.scrollIntoView = vi.fn();
});

function Harness() {
	const { markAdded, revealRef } = useRevealOnAdd();
	const [items, setItems] = useState<string[]>(["a"]);
	return (
		<div>
			<button
				type="button"
				onClick={() => {
					const key = String(items.length);
					markAdded(key);
					setItems((prev) => [...prev, key]);
				}}
			>
				add
			</button>
			{items.map((it, i) => (
				<div key={it} ref={revealRef(String(i))} data-testid={`card-${i}`}>
					<input data-testid={`input-${i}`} />
				</div>
			))}
		</div>
	);
}

describe("useRevealOnAdd", () => {
	it("scrolls to and focuses the newly-added card's first field", () => {
		render(<Harness />);
		// Nothing marked yet → no scroll on initial mount.
		expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();

		fireEvent.click(screen.getByText("add"));

		// Exactly one card scrolled — the new one, not the pre-existing card-0.
		expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(1);
		expect(screen.getByTestId("input-1")).toBe(document.activeElement);
	});

	it("does not re-scroll or steal focus on later re-renders", () => {
		render(<Harness />);
		fireEvent.click(screen.getByText("add"));
		expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(1);

		// A second add reveals only the second new card (one more call), and the
		// first-added card is never revealed again.
		fireEvent.click(screen.getByText("add"));
		expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(2);
		expect(screen.getByTestId("input-2")).toBe(document.activeElement);
	});
});
