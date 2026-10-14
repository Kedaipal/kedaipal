// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PickupNotes } from "./pickup-notes";

afterEach(cleanup);

describe("PickupNotes", () => {
	it("renders nothing at all when there is nothing to say", () => {
		const { container } = render(<PickupNotes notes={[]} audience="buyer" />);
		expect(container.innerHTML).toBe("");
	});

	it("one note is a sentence, several are a list", () => {
		const { unmount } = render(
			<PickupNotes notes={["Side counter."]} audience="buyer" />,
		);
		expect(screen.getByText("Side counter.").tagName).toBe("P");
		expect(screen.queryByRole("list")).toBeNull();
		unmount();

		render(
			<PickupNotes
				notes={["Side counter.", "Bring an ice bag."]}
				audience="buyer"
			/>,
		);
		expect(screen.getAllByRole("listitem")).toHaveLength(2);
	});

	it("speaks to the buyer in their language, with the shared heading", () => {
		const { unmount } = render(<PickupNotes notes={["x"]} audience="buyer" />);
		expect(screen.getByText("Before you collect")).toBeTruthy();
		unmount();
		render(<PickupNotes notes={["x"]} audience="buyer" locale="ms" />);
		expect(screen.getByText("Sebelum anda ambil")).toBeTruthy();
	});

	it("tells the seller these are frozen product notes, not order notes", () => {
		render(<PickupNotes notes={["x"]} audience="seller" />);
		expect(screen.getByText("Before they collect")).toBeTruthy();
		expect(
			screen.getByText(/as it read when this order was placed/i),
		).toBeTruthy();
	});

	it("makes a bare URL in a note tappable, opening safely in a new tab", () => {
		render(
			<PickupNotes
				notes={["Pin: https://maps.app.goo.gl/abc123 — side gate."]}
				audience="buyer"
			/>,
		);
		const link = screen.getByRole("link", {
			name: "https://maps.app.goo.gl/abc123",
		});
		expect(link.getAttribute("href")).toBe("https://maps.app.goo.gl/abc123");
		expect(link.getAttribute("target")).toBe("_blank");
		expect(link.getAttribute("rel")).toContain("noopener");
		expect(screen.getByText(/side gate\./)).toBeTruthy();
	});

	it("links URLs inside every note of a list", () => {
		render(
			<PickupNotes
				notes={["Side counter.", "Parking: www.example.com/park"]}
				audience="seller"
			/>,
		);
		expect(screen.getByRole("link").getAttribute("href")).toBe(
			"https://www.example.com/park",
		);
	});

	it("renders a note as TEXT — markup in a seller's note is never interpreted", () => {
		render(
			<PickupNotes
				notes={['<img src=x onerror="alert(1)">']}
				audience="buyer"
			/>,
		);
		expect(document.querySelector("img")).toBeNull();
		expect(screen.getByText('<img src=x onerror="alert(1)">')).toBeTruthy();
	});

	it("uses a text token that is legible ON the tint", () => {
		const { container } = render(
			<PickupNotes notes={["x"]} audience="buyer" />,
		);
		expect(container.innerHTML).toContain("bg-accent/10");
		expect(container.innerHTML).toContain("text-accent-emphasis");
		expect(container.innerHTML).not.toContain("text-accent-foreground");
	});
});
