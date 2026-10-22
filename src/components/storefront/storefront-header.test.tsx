// @vitest-environment jsdom
import {
	cleanup,
	fireEvent,
	render,
	screen,
	within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DAY_MS, todayMytMidnight } from "../../../convex/lib/fulfilmentDate";
import {
	fulfilmentLabel,
	StorefrontHeader,
	storeInitials,
} from "./storefront-header";

vi.mock("../../lib/share", () => ({ shareLink: vi.fn() }));

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

const retailer = {
	storeName: "Dapur Nadia",
	storeDescription: "Kuih & pastry pre-order",
	waPhone: "60123456789",
	locale: "en" as const,
};

/** The two surfaces the actions live on: the cover's icon circles (mobile,
 * `lg:hidden`) and the island's labelled row (`hidden lg:flex`). jsdom
 * applies no CSS, so both render; the tests tell them apart by name. */
const coverChat = () =>
	screen.queryByRole("link", { name: /^Ask Dapur Nadia on WhatsApp$/ });
const coverShare = () =>
	screen.queryByRole("button", { name: "Share this store" });
const coverTheme = () =>
	screen.queryByRole("button", { name: /^Switch to (dark|light) mode$/ });
const rowChat = () => screen.queryByRole("link", { name: "Ask on WhatsApp" });
const rowShare = () => screen.queryByRole("button", { name: "Share store" });

describe("StorefrontHeader — the island (z8r3fdvwcy)", () => {
	it("makes the store name the page <h1>, inside an 'About this store' island", () => {
		render(<StorefrontHeader retailer={retailer} />);
		const island = screen.getByRole("region", { name: "About this store" });
		const heading = within(island).getByRole("heading", { level: 1 });
		expect(heading.textContent).toBe("Dapur Nadia");
		expect(heading.className).not.toContain("truncate");
	});

	it("with a cover: the photo is the LCP image under a scrim, and the icons are frosted", () => {
		const { container } = render(
			<StorefrontHeader
				retailer={{ ...retailer, coverImageUrl: "https://img/cover.jpg" }}
				slug="dapur-nadia"
			/>,
		);
		const cover = container.querySelector(
			"img[alt='Dapur Nadia cover']",
		) as HTMLImageElement;
		expect(cover).toBeTruthy();
		expect(cover.getAttribute("loading")).not.toBe("lazy");
		expect(cover.getAttribute("fetchpriority")).toBe("high");
		expect(coverShare()?.className).toContain("backdrop-blur");
		expect(coverChat()?.className).toContain("bg-primary/45");
	});

	it("without a cover: a mint band stands in and the icons go outline", () => {
		render(<StorefrontHeader retailer={retailer} slug="dapur-nadia" />);
		expect(screen.queryByRole("img", { name: /cover/ })).toBeNull();
		expect(coverShare()?.className).toContain("border-border");
		expect(coverShare()?.className).not.toContain("backdrop-blur");
		expect(coverChat()?.className).toContain("bg-card");
	});

	it("no blurb → no blurb row", () => {
		const { container } = render(
			<StorefrontHeader retailer={{ storeName: "Lekor Mr Ganu" }} />,
		);
		expect(container.querySelector("p.line-clamp-2")).toBeNull();
		expect(screen.queryByText("Browse & order on WhatsApp")).toBeNull();
	});

	it("renders an initials tile when the store has no logo — never a hole", () => {
		render(<StorefrontHeader retailer={retailer} />);
		expect(screen.getByText("DN")).toBeTruthy();
	});

	it("carries no Kedaipal mark — the footer owns 'Powered by'", () => {
		const { container } = render(<StorefrontHeader retailer={retailer} />);
		const srcs = Array.from(container.querySelectorAll("img")).map((img) =>
			img.getAttribute("src"),
		);
		expect(srcs).not.toContain("/logo-3.svg");
		expect(srcs).not.toContain("/logo-dark.svg");
	});
});

describe("StorefrontHeader — cover icons and the labelled row", () => {
	it("mobile: WhatsApp then Share as 44px labelled icon circles, hidden from lg", () => {
		render(<StorefrontHeader retailer={retailer} slug="dapur-nadia" />);
		const chat = coverChat() as HTMLAnchorElement;
		const share = coverShare() as HTMLButtonElement;
		expect(chat.getAttribute("aria-label")).toBe("Ask Dapur Nadia on WhatsApp");
		expect(chat.className).toContain("size-11");
		expect(share.className).toContain("size-11");
		// Left → right: WhatsApp, Share.
		expect(
			chat.compareDocumentPosition(share) & Node.DOCUMENT_POSITION_FOLLOWING,
		).toBeTruthy();
		expect(chat.className).toContain("lg:hidden");
		expect(share.className).toContain("lg:hidden");
	});

	it("the theme flip is the LAST cover icon, wears the same skin, and stays at every width (z8r3fdwc19)", () => {
		render(
			<StorefrontHeader
				retailer={{ ...retailer, coverImageUrl: "https://img/cover.jpg" }}
				slug="dapur-nadia"
			/>,
		);
		const theme = coverTheme() as HTMLButtonElement;
		const share = coverShare() as HTMLButtonElement;
		expect(theme.parentElement).toBe(share.parentElement);
		expect(
			share.compareDocumentPosition(theme) & Node.DOCUMENT_POSITION_FOLLOWING,
		).toBeTruthy();
		// Frosted on a photo, like its neighbours — and NOT lg:hidden: on
		// desktop it is the one icon left on the cover.
		expect(theme.className).toContain("backdrop-blur");
		expect(theme.className).not.toContain("lg:hidden");
		expect(theme.parentElement?.className).not.toContain("lg:hidden");
		// Icon only: the name is the aria-label, no visible words.
		expect(theme.textContent).toBe("");
	});

	it("the theme flip goes outline on the no-cover band, and renders with nothing else to show", () => {
		render(<StorefrontHeader retailer={{ storeName: "Lekor Mr Ganu" }} />);
		// No slug (no Share) and no WhatsApp: the row still carries the flip.
		expect(coverShare()).toBeNull();
		expect(coverChat()).toBeNull();
		expect(coverTheme()?.className).toContain("border-border");
	});

	it("desktop: the labelled row lives inside the island and is hidden below lg", () => {
		render(<StorefrontHeader retailer={retailer} slug="dapur-nadia" />);
		const island = screen.getByRole("region", { name: "About this store" });
		const share = rowShare() as HTMLButtonElement;
		const chat = rowChat() as HTMLAnchorElement;
		expect(island.contains(share)).toBe(true);
		expect(island.contains(chat)).toBe(true);
		expect(share.className).toContain("h-11");
		expect(share.parentElement?.className).toContain("hidden");
		expect(share.parentElement?.className).toContain("lg:flex");
	});

	it("Ask on WhatsApp is a wa.me link with the store-named prefill, opening in a new tab", () => {
		render(<StorefrontHeader retailer={retailer} slug="dapur-nadia" />);
		for (const link of [coverChat(), rowChat()]) {
			expect(link?.getAttribute("href")).toBe(
				`https://wa.me/60123456789?text=${encodeURIComponent(
					"Hi Dapur Nadia, I'm looking at your Kedaipal store and have a question.",
				)}`,
			);
			expect(link?.getAttribute("target")).toBe("_blank");
			expect(link?.getAttribute("rel")).toContain("noopener");
		}
	});

	it("speaks the store's locale in the prefill", () => {
		render(<StorefrontHeader retailer={{ ...retailer, locale: "ms" }} />);
		expect(
			decodeURIComponent(coverChat()?.getAttribute("href") ?? ""),
		).toContain("Hai Dapur Nadia, saya sedang lihat");
	});

	it("Share shares the store URL from either surface", async () => {
		const { shareLink } = await import("../../lib/share");
		render(<StorefrontHeader retailer={retailer} slug="dapur-nadia" />);
		fireEvent.click(coverShare() as HTMLElement);
		fireEvent.click(rowShare() as HTMLElement);
		expect(shareLink).toHaveBeenCalledTimes(2);
		expect(shareLink).toHaveBeenCalledWith("/dapur-nadia");
	});

	it("offers Share only when it has the slug to share", () => {
		render(<StorefrontHeader retailer={retailer} />);
		expect(coverShare()).toBeNull();
		expect(rowShare()).toBeNull();
		// The chat action does not depend on the slug.
		expect(coverChat()).toBeTruthy();
	});

	it("the owner switched chat off: no WhatsApp action on either surface, Share stays", () => {
		render(
			<StorefrontHeader
				retailer={{ ...retailer, storefrontChatEnabled: false }}
				slug="dapur-nadia"
			/>,
		);
		expect(coverChat()).toBeNull();
		expect(rowChat()).toBeNull();
		expect(coverShare()).toBeTruthy();
		expect(rowShare()).toBeTruthy();
	});

	it("no WhatsApp number on the store: no chat action, Share stays", () => {
		render(
			<StorefrontHeader
				retailer={{ ...retailer, waPhone: undefined }}
				slug="dapur-nadia"
			/>,
		);
		expect(coverChat()).toBeNull();
		expect(rowChat()).toBeNull();
		expect(coverShare()).toBeTruthy();
	});

	it("neither action: no empty icon strip, no empty row", () => {
		const { container } = render(
			<StorefrontHeader
				retailer={{ storeName: "Quiet", waPhone: undefined }}
			/>,
		);
		expect(container.querySelector(".lg\\:hidden")).toBeNull();
		expect(container.querySelector(".hidden.lg\\:flex")).toBeNull();
	});
});

describe("StorefrontHeader — the facts block", () => {
	it("says what the store fulfils, with the area when the seller wrote one", () => {
		render(
			<StorefrontHeader
				retailer={{
					...retailer,
					offerSelfCollect: true,
					storeArea: "TTDI, KL",
				}}
			/>,
		);
		expect(screen.getByText("Delivery & pickup")).toBeTruthy();
		expect(screen.getByText("· TTDI, KL")).toBeTruthy();
	});

	it("no hours and no closure → the facts block is only the fulfilment line", () => {
		const { container } = render(<StorefrontHeader retailer={retailer} />);
		expect(screen.getByText("Delivery")).toBeTruthy();
		expect(screen.queryByRole("button", { name: /Open|Closed/ })).toBeNull();
		expect(container.querySelectorAll("p.min-h-6")).toHaveLength(1);
	});

	it("a store offering neither delivery nor pickup carries no facts block at all", () => {
		const { container } = render(
			<StorefrontHeader
				retailer={{
					...retailer,
					offerDelivery: false,
					offerSelfCollect: false,
				}}
			/>,
		);
		expect(container.querySelector(".border-t")).toBeNull();
	});
});

describe("fulfilmentLabel", () => {
	it("reads the legacy defaults: delivery absent = on, pickup absent = off", () => {
		expect(fulfilmentLabel({})).toBe("Delivery");
		expect(fulfilmentLabel({ offerSelfCollect: true })).toBe(
			"Delivery & pickup",
		);
		expect(
			fulfilmentLabel({ offerDelivery: false, offerSelfCollect: true }),
		).toBe("Pickup");
		expect(fulfilmentLabel({ offerDelivery: false })).toBeNull();
	});
});

describe("storeInitials", () => {
	it("takes the first letters of the first two words", () => {
		expect(storeInitials("Kek Sayang Bakery")).toBe("KS");
	});

	it("takes two characters of a single-word name", () => {
		expect(storeInitials("Hermoolah")).toBe("HE");
	});

	it("survives an empty name", () => {
		expect(storeInitials("  ")).toBe("");
	});
});

describe("StorefrontHeader — opening hours line (86eyp5rav)", () => {
	// An all-day week keeps the assertion clock-independent: whatever minute
	// the test runs at, the status is "Open 24 hours today".
	const allDayWeek = Array.from({ length: 7 }, () => ({
		open: 0,
		close: 1439,
	}));

	it("renders the live status row when the store configured hours", () => {
		render(
			<StorefrontHeader retailer={{ ...retailer, openingHours: allDayWeek }} />,
		);
		const row = screen.getByRole("button", { name: /Open 24 hours today/ });
		// The island row, not the old pill: a full-width row with a chevron.
		expect(row.className).toContain("w-full");
		expect(row.className).not.toContain("rounded-full");
	});

	it("renders nothing for the 24/7 default (no configured hours)", () => {
		render(<StorefrontHeader retailer={retailer} />);
		expect(screen.queryByText(/Open 24 hours|Closed ·|Open now/)).toBeNull();
	});
});

describe("StorefrontHeader — closed dates (z8r3fdhpm7)", () => {
	// Clock-independent: every range is built from the real "today".
	const today = todayMytMidnight(Date.now());
	const allDayWeek = Array.from({ length: 7 }, () => ({
		open: 0,
		close: 1439,
	}));

	it("on a closed date, a 24/7 store says so — with the reason and when it reopens", () => {
		render(
			<StorefrontHeader
				retailer={{
					...retailer,
					closedDates: [
						{ startDate: today, endDate: today, label: "Hari Raya" },
					],
				}}
			/>,
		);
		expect(
			screen.getByRole("button", {
				name: "Closed today · Hari Raya · reopens tomorrow",
			}),
		).toBeTruthy();
	});

	it("a 24/7 store with only a closure ahead: the heads-up IS the hours row, once", () => {
		const start = today + 3 * DAY_MS;
		render(
			<StorefrontHeader
				retailer={{
					...retailer,
					closedDates: [
						{
							startDate: start,
							endDate: start + DAY_MS,
							label: "Balik kampung",
						},
					],
				}}
			/>,
		);
		expect(screen.getAllByText(/Balik kampung/)).toHaveLength(1);
		const row = screen.getByRole("button", { name: /Balik kampung/ });
		// Its own amber, never the live-status mint: the store is OPEN today.
		expect(screen.getByText(/Balik kampung/).className).toContain(
			"text-amber-700",
		);
		expect(row.querySelector(".bg-accent")).toBeNull();
	});

	it("a store with hours AND a closure ahead: status row, then the closed-dates line", () => {
		const start = today + 3 * DAY_MS;
		render(
			<StorefrontHeader
				retailer={{
					...retailer,
					openingHours: allDayWeek,
					closedDates: [
						{ startDate: start, endDate: start, label: "Stocktake" },
					],
				}}
			/>,
		);
		const status = screen.getByRole("button", { name: /Open 24 hours today/ });
		const headsUp = screen.getByText(/^Closed .* · Stocktake$/);
		expect(headsUp.closest("button")).toBeNull();
		expect(
			status.compareDocumentPosition(headsUp) &
				Node.DOCUMENT_POSITION_FOLLOWING,
		).toBeTruthy();
	});

	it("stays silent for a 24/7 store whose only closure is far off", () => {
		const start = today + 40 * DAY_MS;
		render(
			<StorefrontHeader
				retailer={{
					...retailer,
					closedDates: [{ startDate: start, endDate: start }],
				}}
			/>,
		);
		expect(screen.queryByText(/Closed/)).toBeNull();
	});

	it("the schedule dialog never shows today's weekly hours as open on a closed date", () => {
		render(
			<StorefrontHeader
				retailer={{
					...retailer,
					openingHours: allDayWeek,
					closedDates: [
						{ startDate: today, endDate: today, label: "Hari Raya" },
					],
				}}
			/>,
		);
		const trigger = screen.getByRole("button", { name: /Closed today/ });
		// A wrapped status stays left-aligned beside its dot (a <button>
		// centres by default).
		expect(trigger.className).toContain("text-left");
		fireEvent.click(trigger);
		const dialog = screen.getByRole("dialog");
		const todayRow = within(dialog)
			.getByText(/· Today/)
			.closest("li");
		expect(todayRow?.textContent).toContain("Closed today");
		expect(within(dialog).getByText("Closed dates")).toBeTruthy();
	});
});
