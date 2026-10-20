// @vitest-environment jsdom
// The footer's social links are the only place kedaipal.com points at our
// own accounts, and a wrong handle is a dead end for a visitor who went
// looking for us. The Instagram link shipped as `@kedaipal_my` — a handle
// that was never ours (Instagram shows "page isn't available") — while the
// real account is `@kedaipal_com`. These pin the live handles literally, so a
// typo in `site-links.ts` goes red here instead of on the visitor's phone.
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { m } from "../../paraglide/messages";
import { Footer } from "./footer";

vi.mock("@tanstack/react-router", () => ({
	Link: ({
		children,
		to,
		className,
	}: {
		children: ReactNode;
		to: string;
		className?: string;
	}) => (
		<a href={to} className={className}>
			{children}
		</a>
	),
}));

afterEach(cleanup);

function socialLink(label: string): HTMLAnchorElement {
	return screen.getByRole("link", { name: label }) as HTMLAnchorElement;
}

describe("landing footer social links", () => {
	it("links Instagram to the live @kedaipal_com account", () => {
		render(<Footer />);
		expect(socialLink(m.footer_instagram()).getAttribute("href")).toBe(
			"https://www.instagram.com/kedaipal_com/",
		);
	});

	it("links TikTok to the live @kedaipal account", () => {
		render(<Footer />);
		expect(socialLink(m.footer_tiktok()).getAttribute("href")).toBe(
			"https://www.tiktok.com/@kedaipal",
		);
	});

	it("opens both social links in a new tab without leaking the opener", () => {
		render(<Footer />);
		for (const label of [m.footer_instagram(), m.footer_tiktok()]) {
			const link = socialLink(label);
			expect(link.getAttribute("target")).toBe("_blank");
			expect(link.getAttribute("rel")).toBe("noopener noreferrer");
		}
	});
});
