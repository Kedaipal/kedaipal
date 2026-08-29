// @vitest-environment jsdom
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SHARE_TAG_PRESETS } from "../../../convex/lib/attribution";
import { TaggedShareLinks } from "./tagged-share-links";

// TanStack Router's <Link> needs a router context; stub it as a plain anchor.
vi.mock("@tanstack/react-router", () => ({
	Link: ({ children, to }: { children: ReactNode; to?: string }) => (
		<a href={to}>{children}</a>
	),
}));

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock("sonner", () => ({
	toast: {
		success: (m: string) => toastSuccess(m),
		error: (m: string) => toastError(m),
	},
}));

const STORE_URL = "https://kedaipal.com/kek-lapis";

let written: string[] = [];

beforeEach(() => {
	written = [];
	toastSuccess.mockClear();
	toastError.mockClear();
	Object.defineProperty(navigator, "clipboard", {
		configurable: true,
		value: {
			writeText: vi.fn(async (t: string) => {
				written.push(t);
			}),
		},
	});
});
afterEach(cleanup);

describe("TaggedShareLinks", () => {
	it("renders one chip per preset", () => {
		render(<TaggedShareLinks storefrontUrl={STORE_URL} />);
		for (const p of SHARE_TAG_PRESETS) {
			// Accessible name spells out the action — the visible label alone
			// ("TikTok") wouldn't tell a screen-reader user what pressing it does.
			expect(
				screen.getByRole("button", { name: `Copy ${p.label} link` }),
			).toBeTruthy();
		}
	});

	it("copies the store link with that preset's ?src= tag", async () => {
		render(<TaggedShareLinks storefrontUrl={STORE_URL} />);
		fireEvent.click(screen.getByRole("button", { name: "Copy TikTok link" }));
		await waitFor(() => expect(written).toEqual([`${STORE_URL}?src=tiktok`]));
		expect(toastSuccess).toHaveBeenCalledWith("TikTok link copied");
	});

	it("fires onCopy so the copy counts as sharing the link", async () => {
		const onCopy = vi.fn();
		render(<TaggedShareLinks storefrontUrl={STORE_URL} onCopy={onCopy} />);
		fireEvent.click(
			screen.getByRole("button", { name: "Copy Instagram link" }),
		);
		await waitFor(() => expect(onCopy).toHaveBeenCalledTimes(1));
	});

	it("each preset shows its own brand glyph, decoratively", () => {
		const { container } = render(
			<TaggedShareLinks storefrontUrl={STORE_URL} />,
		);
		// The glyph is what a seller actually scans for, so assert the marks are
		// present and distinct rather than trusting the text label alone.
		for (const p of SHARE_TAG_PRESETS) {
			const glyph = container.querySelector(`[data-brand="${p.label}"]`);
			expect(glyph).toBeTruthy();
			// Decorative: the button already carries the accessible name, so the
			// mark must stay out of the a11y tree rather than doubling it up.
			expect(glyph?.getAttribute("aria-hidden")).toBe("true");
		}
	});

	it("the pressed button itself confirms the copy", async () => {
		render(<TaggedShareLinks storefrontUrl={STORE_URL} />);
		fireEvent.click(screen.getByRole("button", { name: "Copy TikTok link" }));
		// Feedback lands in the button, not only in a toast that can be missed.
		await waitFor(() => expect(screen.getByText("Copied")).toBeTruthy());
		// ...and only on the one that was pressed.
		expect(
			screen.getByRole("button", { name: "Copy Instagram link" }).textContent,
		).toBe("Instagram");
	});

	it("a denied clipboard surfaces the link instead of failing silently", async () => {
		Object.defineProperty(navigator, "clipboard", {
			configurable: true,
			value: {
				writeText: vi.fn(async () => {
					throw new Error("denied");
				}),
			},
		});
		const onCopy = vi.fn();
		render(<TaggedShareLinks storefrontUrl={STORE_URL} onCopy={onCopy} />);
		fireEvent.click(screen.getByRole("button", { name: "Copy Facebook link" }));
		await waitFor(() =>
			expect(toastError).toHaveBeenCalledWith(
				`Couldn't copy automatically — your link is ${STORE_URL}?src=facebook`,
			),
		);
		// Nothing reached the clipboard, so it isn't a "shared" signal.
		expect(onCopy).not.toHaveBeenCalled();
	});
});
