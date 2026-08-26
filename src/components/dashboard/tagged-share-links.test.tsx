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
			expect(screen.getByRole("button", { name: p.label })).toBeTruthy();
		}
	});

	it("copies the store link with that preset's ?src= tag", async () => {
		render(<TaggedShareLinks storefrontUrl={STORE_URL} />);
		fireEvent.click(screen.getByRole("button", { name: "TikTok" }));
		await waitFor(() =>
			expect(written).toEqual([`${STORE_URL}?src=tiktok`]),
		);
		expect(toastSuccess).toHaveBeenCalledWith("TikTok link copied");
	});

	it("fires onCopy so the copy counts as sharing the link", async () => {
		const onCopy = vi.fn();
		render(<TaggedShareLinks storefrontUrl={STORE_URL} onCopy={onCopy} />);
		fireEvent.click(screen.getByRole("button", { name: "Instagram" }));
		await waitFor(() => expect(onCopy).toHaveBeenCalledTimes(1));
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
		fireEvent.click(screen.getByRole("button", { name: "Facebook" }));
		await waitFor(() =>
			expect(toastError).toHaveBeenCalledWith(
				`Couldn't copy automatically — your link is ${STORE_URL}?src=facebook`,
			),
		);
		// Nothing reached the clipboard, so it isn't a "shared" signal.
		expect(onCopy).not.toHaveBeenCalled();
	});
});
