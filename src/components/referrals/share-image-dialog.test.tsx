// @vitest-environment jsdom
// "Share as an image" (docs/referrals.md § The share image): the preview IS
// the drawn PNG, Square and Story are one pick-one choice, a device that can
// share files gets Share first (the share sheet, not a download), every other
// device gets Download, and a failed draw is a retry — never a dead end.
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const render$ = vi.fn();
vi.mock("../../lib/referral-share-image", async (importActual) => ({
	...(await importActual<typeof import("../../lib/referral-share-image")>()),
	renderReferralShareImage: (opts: unknown) => render$(opts),
}));
const track = vi.fn();
vi.mock("../../lib/ga-events", () => ({
	trackReferralShare: (...a: unknown[]) => track(...a),
}));
const copied = vi.fn();
vi.mock("../../lib/referral-share", () => ({
	copyText: async (text: string) => {
		copied(text);
		return true;
	},
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { ShareImageDialog } = await import("./share-image-dialog");

const LINK = "https://kedaipal.com/referral/kekmakjah";
function open() {
	return render(
		<ShareImageDialog
			open
			onClose={() => {}}
			storeName="Kek Mak Jah"
			slug="kekmakjah"
			link={LINK}
			surface="page"
		/>,
	);
}

const nav = navigator as Navigator & {
	canShare?: Navigator["canShare"];
	share?: Navigator["share"];
};

beforeEach(() => {
	render$.mockResolvedValue(new Blob(["png"], { type: "image/png" }));
	URL.createObjectURL = vi.fn(() => "blob:card");
	URL.revokeObjectURL = vi.fn();
});
afterEach(() => {
	cleanup();
	render$.mockReset();
	track.mockClear();
	copied.mockClear();
	Reflect.deleteProperty(nav, "canShare");
	Reflect.deleteProperty(nav, "share");
});

describe("ShareImageDialog", () => {
	test("the preview is the drawn PNG — Square first, Story on switch", async () => {
		open();
		const img = await screen.findByRole("img", {
			name: /Kek Mak Jah invites you/,
		});
		expect(img.getAttribute("src")).toBe("blob:card");
		expect(render$).toHaveBeenLastCalledWith(
			expect.objectContaining({
				format: "square",
				storeName: "Kek Mak Jah",
				link: LINK,
			}),
		);
		const square = screen.getByRole("button", { name: /Square/ });
		const story = screen.getByRole("button", { name: /Story/ });
		expect(square.getAttribute("aria-pressed")).toBe("true");
		fireEvent.click(story);
		expect(story.getAttribute("aria-pressed")).toBe("true");
		await waitFor(() =>
			expect(render$).toHaveBeenLastCalledWith(
				expect.objectContaining({ format: "story" }),
			),
		);
	});

	test("a device that can't share files gets Download, and the save is counted", async () => {
		const click = vi
			.spyOn(HTMLAnchorElement.prototype, "click")
			.mockImplementation(() => {});
		open();
		await screen.findByRole("img");
		expect(screen.queryByRole("button", { name: /Share image/ })).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: /Download PNG/ }));
		expect(click).toHaveBeenCalled();
		const a = click.mock.contexts[0] as HTMLAnchorElement;
		expect(a.download).toBe("kedaipal-invite-kekmakjah-square.png");
		expect(track).toHaveBeenCalledWith("image", "page");
		click.mockRestore();
	});

	test("a phone that can share files gets Share first — the file goes to the share sheet", async () => {
		nav.canShare = () => true;
		const share = vi.fn().mockResolvedValue(undefined);
		nav.share = share;
		open();
		await screen.findByRole("img");
		const button = await screen.findByRole("button", { name: /Share image/ });
		expect(screen.getByRole("button", { name: /Save image/ })).toBeTruthy();
		// Said for any device that can share — a Mac shares too, not only a phone.
		expect(screen.getByText(/^Opens your share sheet/)).toBeTruthy();
		await act(async () => {
			fireEvent.click(button);
		});
		const files = share.mock.calls[0][0].files as File[];
		expect(files[0].name).toBe("kedaipal-invite-kekmakjah-square.png");
		expect(files[0].type).toBe("image/png");
		expect(track).toHaveBeenCalledWith("image_share", "page");
	});

	test("closing the share sheet is a choice, not a failure — nothing counted", async () => {
		nav.canShare = () => true;
		nav.share = vi
			.fn()
			.mockRejectedValue(new DOMException("closed", "AbortError"));
		open();
		await screen.findByRole("img");
		await act(async () => {
			fireEvent.click(
				await screen.findByRole("button", { name: /Share image/ }),
			);
		});
		expect(track).not.toHaveBeenCalled();
	});

	test("a failed draw offers a retry, never a blank stage", async () => {
		render$.mockRejectedValueOnce(new Error("canvas"));
		open();
		const retry = await screen.findByRole("button", { name: "Try again" });
		expect(screen.getByText("Couldn't draw the image.")).toBeTruthy();
		fireEvent.click(retry);
		expect(await screen.findByRole("img")).toBeTruthy();
		expect(render$).toHaveBeenCalledTimes(2);
	});

	test("Copy link copies the invite link and is counted", async () => {
		open();
		await act(async () => {
			fireEvent.click(screen.getByRole("button", { name: /Copy link/ }));
		});
		expect(copied).toHaveBeenCalledWith(LINK);
		expect(track).toHaveBeenCalledWith("copy_link", "page");
	});
});
