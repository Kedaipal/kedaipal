import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "@tanstack/react-router";
import { useMutation } from "convex/react";
import { Sparkles } from "lucide-react";
import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { api } from "../../../convex/_generated/api";
import type { Locale } from "../../../convex/lib/locale";
import { RELEASES } from "../../content/releases";
import { APP_VERSION, isCalendarVersion } from "../../lib/app-version";
import { localized, resolveWhatsNew } from "../../lib/releases";
import { Button } from "../ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "../ui/dialog";

/**
 * "What's new" — seller-facing release notes (ClickUp 86eyqgxv9).
 *
 * Two surfaces, ONE source of entries (`src/content/releases.ts`) and one piece
 * of state, so the dot and the modal can never disagree:
 *
 *  - a **permanent entry** in the nav chrome, always openable, carrying a dot
 *    when something is unseen — so a dismissed announcement is never lost;
 *  - a **modal** that opens unprompted only for a release marked `notable`.
 *    Everything else gets the dot. A modal on every release trains sellers to
 *    dismiss reflexively, and then the one that matters is dismissed too.
 *
 * Lives in a context because `Sidebar` (desktop) and `BottomNav` (mobile) are
 * BOTH mounted at all times and merely hidden by breakpoint — a hook used in
 * each would auto-open two dialogs and fire two stamps.
 *
 * Buyers never reach this: it mounts only inside the `/app` shell.
 */

interface WhatsNewValue {
	/** Something unseen — drives the dot on the nav entries. */
	hasUnseen: boolean;
	/** Open the panel on demand (the nav entries call this). */
	open: () => void;
	/** Hidden entirely — no retailer for this identity, or nothing to show. */
	available: boolean;
}

const WhatsNewContext = createContext<WhatsNewValue | null>(null);

/**
 * Never interrupt a sale. `/app/checkout` is the counter flow — the seller is
 * standing in front of a paying customer, and a release-notes modal there is
 * the single worst moment we could pick. It waits for their next visit; the
 * dot persists either way, so nothing is lost.
 */
const SUPPRESSED_PATHS = ["/app/checkout"];

export function WhatsNewProvider({
	locale,
	children,
}: {
	locale: Locale;
	children: ReactNode;
}) {
	const { pathname } = useLocation();
	const [open, setOpen] = useState(false);
	const markSeen = useMutation(api.releases.markSeen);

	const seen = useQuery(convexQuery(api.releases.getSeenVersion, {})).data;

	const state = useMemo(
		() =>
			resolveWhatsNew({
				releases: RELEASES,
				// `undefined` (loading) and `null` (no retailer) are different: only
				// the former should be treated as "not yet known". A caller with no
				// retailer has nothing to show and nothing to stamp.
				seenVersion: seen === undefined ? undefined : (seen?.seenVersion ?? null),
				currentVersion: APP_VERSION,
			}),
		[seen],
	);

	const hasRetailer = seen !== undefined && seen !== null;
	const suppressed = SUPPRESSED_PATHS.some((p) => pathname.startsWith(p));

	// Stamping is skipped when APP_VERSION isn't a real calendar version — i.e.
	// local dev, where the Vite define yields "dev". The server would reject it
	// anyway; skipping means dev keeps re-showing the panel, which is what you
	// want while writing release notes.
	const canStamp = hasRetailer && isCalendarVersion(APP_VERSION);
	const stamped = useRef(false);
	const stamp = useCallback(() => {
		if (!canStamp || stamped.current) return;
		stamped.current = true;
		// Fire-and-forget: a failed stamp costs the seller one repeat view of the
		// panel, which is strictly better than blocking the UI on it.
		void markSeen({ version: APP_VERSION }).catch(() => {
			stamped.current = false;
		});
	}, [canStamp, markSeen]);

	// Catch-up: a seller with no stored version has, in the only sense that
	// matters, already seen everything shipped so far — they have been using it.
	// Stamp silently and show nothing. See `WhatsNewState.silentCatchUp`.
	useEffect(() => {
		if (state.silentCatchUp) stamp();
	}, [state.silentCatchUp, stamp]);

	const autoOpened = useRef(false);
	useEffect(() => {
		if (!state.autoOpen || autoOpened.current || suppressed) return;
		autoOpened.current = true;
		setOpen(true);
	}, [state.autoOpen, suppressed]);

	function handleOpenChange(next: boolean) {
		setOpen(next);
		// Closing IS the acknowledgement — whether it opened itself or the seller
		// opened it from the menu. There is no separate "mark as read" for them to
		// miss.
		if (!next) stamp();
	}

	const value = useMemo<WhatsNewValue>(
		() => ({
			hasUnseen: state.unseenVersions.size > 0,
			open: () => setOpen(true),
			available: hasRetailer && state.all.length > 0,
		}),
		[state.unseenVersions, state.all.length, hasRetailer],
	);

	return (
		<WhatsNewContext.Provider value={value}>
			{children}
			{value.available ? (
				<WhatsNewDialog
					open={open}
					onOpenChange={handleOpenChange}
					locale={locale}
					unseenVersions={state.unseenVersions}
					releases={state.all}
				/>
			) : null}
		</WhatsNewContext.Provider>
	);
}

/**
 * Nav-entry state. Returns `null` outside the provider so a nav component can
 * render without one (storeless admin chrome, tests) instead of throwing.
 */
export function useWhatsNew(): WhatsNewValue | null {
	return useContext(WhatsNewContext);
}

function WhatsNewDialog({
	open,
	onOpenChange,
	locale,
	unseenVersions,
	releases,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	locale: Locale;
	unseenVersions: Set<string>;
	releases: typeof RELEASES;
}) {
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-lg">
				<DialogHeader>
					<DialogTitle>What's new</DialogTitle>
					<DialogDescription>
						Recent updates to Kedaipal. Nothing here needs any action from you.
					</DialogDescription>
				</DialogHeader>
				{/* The list scrolls inside the dialog rather than growing it — on a
				    phone a few releases would otherwise push the close button off
				    screen. */}
				<div className="-mx-1 max-h-[60vh] overflow-y-auto px-1">
					<ol className="flex flex-col gap-5">
						{releases.map((release) => (
							<li key={release.version} className="flex flex-col gap-2">
								<div className="flex items-center gap-2">
									<span className="text-xs font-medium tabular-nums text-muted-foreground">
										{release.version}
									</span>
									{unseenVersions.has(release.version) ? (
										<span className="rounded-full bg-accent/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent-emphasis">
											New
										</span>
									) : null}
								</div>
								{release.entries.map((entry) => (
									<div
										key={localized(entry.title, locale)}
										className="flex flex-col gap-1"
									>
										<h3 className="font-heading text-base leading-snug">
											{localized(entry.title, locale)}
										</h3>
										<p className="text-sm leading-relaxed text-muted-foreground">
											{localized(entry.body, locale)}
										</p>
										{entry.href ? (
											// The deep link is what turns an announcement into
											// adoption — without it a seller reads the note, nods,
											// and never finds the setting.
											<Link
												to={entry.href}
												onClick={() => onOpenChange(false)}
												className="w-fit text-sm font-medium text-accent-emphasis underline underline-offset-4"
											>
												{entry.hrefLabel
													? localized(entry.hrefLabel, locale)
													: "Take a look"}
											</Link>
										) : null}
									</div>
								))}
							</li>
						))}
					</ol>
				</div>
				<DialogFooter>
					<Button onClick={() => onOpenChange(false)}>Got it</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

/**
 * The nav entry. Renders nothing when there is nothing to show, so a storeless
 * admin and a fresh deploy with no notes don't get a dead menu item.
 */
export function WhatsNewNavItem({
	className,
	variant,
}: {
	className?: string;
	/** `row` = More panel (icon + label + sub), `link` = sidebar (compact). */
	variant: "row" | "link";
	}) {
	const whatsNew = useWhatsNew();
	if (!whatsNew?.available) return null;

	const dot = whatsNew.hasUnseen ? (
		<span
			aria-hidden
			className="size-2 shrink-0 rounded-full bg-accent-emphasis"
		/>
	) : null;

	// The accessible name carries the unseen state — a colour-only dot is
	// invisible to a screen reader and to anyone who can't distinguish it.
	const label = whatsNew.hasUnseen ? "What's new (unread updates)" : "What's new";

	if (variant === "link") {
		return (
			<button
				type="button"
				onClick={whatsNew.open}
				aria-label={label}
				className={`flex h-9 items-center gap-2 rounded-lg px-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent/10 hover:text-foreground ${className ?? ""}`}
			>
				<Sparkles className="size-4 shrink-0" />
				<span>What's new</span>
				{dot}
			</button>
		);
	}

	return (
		<button
			type="button"
			onClick={whatsNew.open}
			aria-label={label}
			className={`flex min-h-[44px] w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors hover:bg-muted ${className ?? ""}`}
		>
			<Sparkles className="size-5 shrink-0 text-muted-foreground" />
			<span className="flex min-w-0 flex-col">
				<span className="flex items-center gap-2 text-sm font-medium">
					What's new
					{dot}
				</span>
				<span className="truncate text-xs text-muted-foreground">
					Recent updates to Kedaipal
				</span>
			</span>
		</button>
	);
}
