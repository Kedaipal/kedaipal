// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Img } from "./image";

afterEach(cleanup);

describe("Img", () => {
	it("renders the fallback (and no <img>) when there is no src", () => {
		render(
			<Img src={null} alt="Store logo" fallback={<span>no image</span>} />,
		);
		expect(screen.getByText("no image")).toBeTruthy();
		expect(screen.queryByRole("img")).toBeNull();
	});

	it("starts hidden with a skeleton, then fades in once the image loads", () => {
		const { container } = render(<Img src="/cover.jpg" alt="Cover" />);
		const img = screen.getByRole("img") as HTMLImageElement;

		// Before load: the image is transparent and a pulsing skeleton holds space.
		expect(img.className).toContain("opacity-0");
		expect(container.querySelector(".animate-pulse")).not.toBeNull();

		fireEvent.load(img);

		// After load: image is opaque and the skeleton is gone.
		expect(img.className).toContain("opacity-100");
		expect(container.querySelector(".animate-pulse")).toBeNull();
	});

	it("falls back gracefully when the image fails to load", () => {
		render(
			<Img src="/broken.jpg" alt="Cover" fallback={<span>broken</span>} />,
		);
		const img = screen.getByRole("img") as HTMLImageElement;

		fireEvent.error(img);

		// The broken <img> is replaced by the fallback node.
		expect(screen.getByText("broken")).toBeTruthy();
		expect(screen.queryByRole("img")).toBeNull();
	});

	it("passes object-fit through className and keeps the wrapper size classes", () => {
		const { container } = render(
			<Img
				src="/logo.png"
				alt="Logo"
				className="object-contain"
				wrapperClassName="size-16 rounded-2xl"
			/>,
		);
		const img = screen.getByRole("img") as HTMLImageElement;
		// tailwind-merge lets the caller's object-contain win over the base cover.
		expect(img.className).toContain("object-contain");
		expect(img.className).not.toContain("object-cover");
		// Wrapper carries the layout classes.
		const wrapper = container.firstElementChild as HTMLElement;
		expect(wrapper.className).toContain("size-16");
		expect(wrapper.className).toContain("rounded-2xl");
	});
});
