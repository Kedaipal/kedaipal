import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "@tanstack/react-router";
import { useMutation } from "convex/react";
import {
	ArrowRight,
	ChartLine,
	Check,
	Clock,
	type LucideIcon,
	Megaphone,
	Package,
	Printer,
	Settings,
	Sparkles,
	Truck,
	Wallet,
	X,
} from "lucide-react";
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
import type { Release, ReleaseIconName } from "../../content/releases";
import { RELEASES } from "../../content/releases";
import { APP_VERSION, isCalendarVersion } from "../../lib/app-version";
import { localized, resolveWhatsNew } from "../../lib/releases";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
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
				seenVersion:
					seen === undefined ? undefined : (seen?.seenVersion ?? null),
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

/**
 * Closed allowlist → component. Keeps the icon set coherent, makes a typo a
 * compile error, and means the bundle carries a known handful rather than
 * whatever any future entry names.
 */
const ENTRY_ICONS: Record<ReleaseIconName, LucideIcon> = {
	printer: Printer,
	clock: Clock,
	package: Package,
	truck: Truck,
	wallet: Wallet,
	megaphone: Megaphone,
	settings: Settings,
	chart: ChartLine,
};

/** `2026-08-25` → `25 Aug`. */
const MONTHS = [
	"Jan",
	"Feb",
	"Mar",
	"Apr",
	"May",
	"Jun",
	"Jul",
	"Aug",
	"Sep",
	"Oct",
	"Nov",
	"Dec",
];
function formatReleaseDate(iso: string): string {
	// Parsed by hand rather than through `new Date(iso)`: that parses an ISO
	// date-only string as UTC midnight and then renders it in the viewer's zone,
	// so a MYT seller would see the previous day. There is no time component
	// here to preserve — the string IS the date we mean.
	const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
	if (!m) return iso;
	const month = MONTHS[Number(m[2]) - 1];
	return month ? `${Number(m[3])} ${month}` : iso;
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
	releases: Release[];
}) {
	const newest = releases[0];
	const caughtUp = unseenVersions.size === 0;

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			{/* `p-0` because the header is a full-bleed navy band — the default
			    padding would inset it and leave white gutters beside the fill.
			    Widened past the default `sm:max-w-sm` (384px): the entry cards are
			    an icon column plus two lines of copy, which reads cramped there. */}
			<DialogContent
				className="gap-0 p-0 sm:max-w-lg"
				showCloseButton={false}
			>
				<div className="flex items-center gap-3 bg-primary p-4">
					<span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent/20">
						<Sparkles className="size-4.5 text-accent" strokeWidth={2} />
					</span>
					<div className="flex min-w-0 flex-1 flex-col gap-0.5">
						<DialogTitle className="text-primary-foreground">
							What's new
						</DialogTitle>
						{/* The header carries the running version in BOTH states, so the
						    seller can always read it back to support from here — it is
						    the same number the sidebar shows. Only the framing changes. */}
						<DialogDescription className="text-primary-foreground/70 tabular-nums">
							{caughtUp
								? `You're on ${APP_VERSION} · up to date`
								: newest
									? `Version ${newest.version} · ${formatReleaseDate(newest.date)}`
									: APP_VERSION}
						</DialogDescription>
					</div>
					<Button
						variant="ghost"
						size="icon-sm"
						onClick={() => onOpenChange(false)}
						className="shrink-0 text-primary-foreground/70 hover:bg-primary-foreground/10 hover:text-primary-foreground"
					>
						<X className="size-4" />
						<span className="sr-only">Close</span>
					</Button>
				</div>

				{/* Scrolls inside the dialog rather than growing it — on a phone a few
				    releases would otherwise push the footer off screen. */}
				<div className="flex max-h-[60vh] flex-col gap-4 overflow-y-auto p-4">
					{releases.map((release) => {
						const isNew = unseenVersions.has(release.version);
						return (
							<section
								key={release.version}
								className="flex flex-col gap-3"
								aria-label={`Version ${release.version}`}
							>
								{/* Every release carries this row, including the newest —
								    one rule for every group, so a one-release panel and a
								    six-release panel are the same object. It costs
								    repeating the version the header already names; the
								    "New" chip is what earns that back. */}
								<div className="flex items-center gap-2">
									<span
										className={cn(
											"text-xs font-semibold tabular-nums",
											isNew ? "text-foreground" : "text-muted-foreground",
										)}
									>
										{release.version}
									</span>
									<span className="text-xs text-muted-foreground">
										{formatReleaseDate(release.date)}
									</span>
									{isNew ? (
										<span className="rounded-full bg-accent/15 px-2 py-0.5 text-[10px] font-bold tracking-wide text-accent-emphasis uppercase">
											New
										</span>
									) : null}
									<span className="h-px flex-1 bg-border" />
								</div>

								<div className="flex flex-col gap-2.5">
									{release.entries.map((entry) => {
										const Icon = entry.icon
											? ENTRY_ICONS[entry.icon]
											: Sparkles;
										return (
											<div
												key={localized(entry.title, locale)}
												className={cn(
													"flex gap-3 rounded-lg border border-border p-3",
													// Seen releases sit back — that is what makes
													// "new" legible without another chip per card.
													isNew ? "bg-card" : "bg-muted/40",
												)}
											>
												<span
													className={cn(
														"flex size-8 shrink-0 items-center justify-center rounded-md",
														isNew ? "bg-accent/12" : "bg-muted",
													)}
												>
													<Icon
														className={cn(
															"size-4",
															isNew
																? "text-accent-emphasis"
																: "text-muted-foreground",
														)}
														strokeWidth={1.8}
													/>
												</span>
												<div className="flex min-w-0 flex-1 flex-col gap-1">
													<h3 className="font-heading text-sm leading-snug font-semibold">
														{localized(entry.title, locale)}
													</h3>
													<p className="text-sm leading-relaxed text-muted-foreground">
														{localized(entry.body, locale)}
													</p>
													{entry.href ? (
														// The deep link is what turns an announcement
														// into adoption — without it a seller reads the
														// note, nods, and never finds the setting.
														<Link
															to={entry.href}
															onClick={() => onOpenChange(false)}
															className="mt-0.5 inline-flex w-fit items-center gap-1 text-sm font-semibold text-accent-emphasis underline-offset-4 hover:underline"
														>
															{entry.hrefLabel
																? localized(entry.hrefLabel, locale)
																: "Set it up"}
															<ArrowRight className="size-3.5" />
														</Link>
													) : null}
												</div>
											</div>
										);
									})}
								</div>
							</section>
						);
					})}
				</div>

				<DialogFooter className="mx-0 mb-0 sm:justify-between">
					{caughtUp ? (
						// The caught-up footer would otherwise be one lonely button in a
						// wide bar. The confirmation line fills it and answers the
						// question the seller opened the panel with.
						<span className="flex items-center gap-1.5 text-sm text-muted-foreground">
							<Check className="size-3.5 text-accent-emphasis" strokeWidth={2.5} />
							You've seen everything
						</span>
					) : (
						<span className="hidden sm:block" />
					)}
					<Button
						// Nothing to acknowledge when there is nothing new, so the mint
						// "Got it" softens to a quiet "Done".
						//
						// "Done", not "Close": the header's X is already named "Close",
						// and two buttons sharing one accessible name inside a single
						// dialog is ambiguous to a screen reader — it reads as the same
						// control twice.
						variant={caughtUp ? "outline" : "default"}
						onClick={() => onOpenChange(false)}
						className="tap-target"
					>
						{caughtUp ? "Done" : "Got it"}
					</Button>
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
	/**
	 * `row` = More panel (icon + label + sub), `meta` = the sidebar's compact
	 * line, `icon` = the collapsed rail, where a label cannot fit.
	 */
	variant: "row" | "meta" | "icon";
}) {
	const whatsNew = useWhatsNew();
	if (!whatsNew?.available) return null;

	const dot = whatsNew.hasUnseen ? (
		<span
			aria-hidden
			className="size-1.5 shrink-0 rounded-full bg-accent-emphasis"
		/>
	) : null;

	// The accessible name carries the unseen state — a colour-only dot is
	// invisible to a screen reader and to anyone who can't distinguish it.
	const label = whatsNew.hasUnseen
		? "What's new (unread updates)"
		: "What's new";

	if (variant === "icon") {
		// Collapsed rail: the label wrapped to two lines and looked broken, so
		// there is no label at all here — the `aria-label` is the whole
		// accessible name, and the dot rides the icon's corner.
		return (
			<button
				type="button"
				onClick={whatsNew.open}
				aria-label={label}
				title={label}
				className={cn(
					"relative flex size-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
					className,
				)}
			>
				<Sparkles className="size-4.5 text-accent-emphasis" />
				{whatsNew.hasUnseen ? (
					<span
						aria-hidden
						className="absolute top-1 right-1 size-1.5 rounded-full bg-accent-emphasis ring-2 ring-card"
					/>
				) : null}
			</button>
		);
	}

	if (variant === "meta") {
		return (
			<button
				type="button"
				onClick={whatsNew.open}
				aria-label={label}
				className={cn(
					"flex items-center gap-1.5 rounded-md px-1 py-0.5 text-xs font-medium text-foreground transition-colors hover:text-accent-emphasis focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
					className,
				)}
			>
				<Sparkles className="size-3.5 shrink-0 text-accent-emphasis" />
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
			className={cn(
				"flex min-h-[44px] w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors hover:bg-muted",
				className,
			)}
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
