import { useAuth } from "@clerk/tanstack-react-start";
import { Link } from "@tanstack/react-router";
import { ArrowRight, Check, Globe, Menu, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { Locale } from "../../../convex/lib/locale";
import { trackSignupCta } from "../../lib/ga-events";
import { BLOG_URL } from "../../lib/site-links";
import { cn } from "../../lib/utils";
import { m } from "../../paraglide/messages";
import { getLocale, locales, setLocale } from "../../paraglide/runtime";
import { Button } from "../ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { ThemeToggle } from "../ui/theme-toggle";
import { Wordmark } from "../ui/wordmark";
import { DemoPill } from "./landing-ui";

// Short trigger label + full dropdown label per locale — keeps the button
// compact in the nav bar while the menu itself is unambiguous.
const SHORT_LABEL: Record<Locale, string> = { en: "EN", ms: "BM", zh: "中文" };
const FULL_LABEL: Record<Locale, () => string> = {
	en: m.lang_en,
	ms: m.lang_ms,
	zh: m.lang_zh,
};

/**
 * 3-way locale switcher (en/ms/zh). A dropdown reads more clearly than a
 * cycle-on-click once there are 3 options — the trigger always shows the
 * CURRENT locale so it's never a silent toggle, and every row is a full
 * ≥44px tap target.
 */
function LanguageSwitcher() {
	const current = getLocale() as Locale;
	const [open, setOpen] = useState(false);

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<Button
					type="button"
					variant="ghost"
					size="lg"
					aria-label={m.lang_switcher_label()}
					className="tap-target rounded-full"
				>
					<Globe />
					<span>{SHORT_LABEL[current]}</span>
				</Button>
			</PopoverTrigger>
			<PopoverContent align="end" className="w-48 p-1.5">
				{(locales as readonly Locale[]).map((loc) => (
					<button
						key={loc}
						type="button"
						onClick={() => {
							setLocale(loc);
							setOpen(false);
						}}
						aria-current={loc === current}
						className={cn(
							"flex min-h-11 w-full items-center justify-between rounded-md px-3 text-sm font-medium transition-colors hover:bg-muted",
							loc === current ? "text-foreground" : "text-muted-foreground",
						)}
					>
						{FULL_LABEL[loc]()}
						{loc === current ? <Check className="size-4" /> : null}
					</button>
				))}
			</PopoverContent>
		</Popover>
	);
}

function NavAuthCta() {
	const { isSignedIn } = useAuth();
	if (isSignedIn) {
		return (
			<Button
				asChild
				size="lg"
				className="tap-target hidden rounded-full px-5 md:inline-flex"
			>
				<Link to="/app">
					{m.nav_go_to_dashboard()}
					<ArrowRight />
				</Link>
			</Button>
		);
	}
	// Demo-first (z8r3fdtpub T1): the bar's one pill is the WhatsApp demo;
	// "Start free" left the bar for the menu and the hero's text link. Log-in
	// stays — a returning paying seller is the one visitor we least want to
	// send through a sales conversation to reach their own dashboard.
	return (
		<>
			<Link
				to="/sign-in/$"
				params={{ _splat: "" }}
				className="hidden min-h-11 items-center whitespace-nowrap rounded-full px-4 text-sm font-semibold text-foreground transition-colors hover:bg-muted md:inline-flex"
			>
				{m.nav_log_in()}
			</Link>
			<DemoPill
				placement="nav"
				className="hidden min-h-11 px-5 text-sm md:inline-flex"
			/>
		</>
	);
}

function MobileMenuAuthCta({ onClose }: { onClose: () => void }) {
	const { isSignedIn } = useAuth();
	if (isSignedIn) {
		return (
			<Button asChild size="lg" className="h-12 w-full rounded-full">
				<Link to="/app" onClick={onClose}>
					{m.nav_go_to_dashboard()}
					<ArrowRight />
				</Link>
			</Button>
		);
	}
	// The stack IS the priority signal on a phone: the demo pill, then the
	// two outline doors — self-serve sign-up, then log-in.
	return (
		<>
			<DemoPill placement="nav-mobile" long className="min-h-12 w-full" />
			<Button
				asChild
				size="lg"
				variant="outline"
				className="h-12 w-full rounded-full"
			>
				<Link
					to="/sign-up/$"
					params={{ _splat: "" }}
					onClick={() => {
						trackSignupCta("nav-mobile");
						onClose();
					}}
				>
					{m.nav_start_free()}
				</Link>
			</Button>
			<Button
				asChild
				size="lg"
				variant="outline"
				className="h-12 w-full rounded-full"
			>
				<Link to="/sign-in/$" params={{ _splat: "" }} onClick={onClose}>
					{m.nav_log_in()}
				</Link>
			</Button>
		</>
	);
}

export function Nav() {
	const [menuOpen, setMenuOpen] = useState(false);
	const [scrolled, setScrolled] = useState(false);

	const closeMenu = useCallback(() => setMenuOpen(false), []);

	useEffect(() => {
		if (!menuOpen) return;
		function onKeyDown(e: KeyboardEvent) {
			if (e.key === "Escape") setMenuOpen(false);
		}
		document.addEventListener("keydown", onKeyDown);
		return () => document.removeEventListener("keydown", onKeyDown);
	}, [menuOpen]);

	useEffect(() => {
		function onScroll() {
			setScrolled(window.scrollY > 24);
		}
		onScroll();
		window.addEventListener("scroll", onScroll, { passive: true });
		return () => window.removeEventListener("scroll", onScroll);
	}, []);

	// The link set: the walkthrough (how an order moves — the two sections the
	// target tier is sold on, folded into one, 19 Oct 2026), the payment rails,
	// then the objections. These are in-page anchors —
	// they only mean anything relative to `/`, which is why they stay `<a>`.
	const navLinks = [
		{ href: "/#flow", label: m.nav_flow() },
		{ href: "/#payments", label: m.nav_payments() },
		{ href: "/#faq", label: m.nav_faq() },
	];

	// `inline-flex` + `min-h-11`, not `py-2`: the bar mixes links, ghost buttons
	// and pills, and only an explicit shared height keeps their hover pills from
	// rendering at three different sizes in one row.
	const linkClass =
		"inline-flex min-h-11 items-center whitespace-nowrap rounded-full px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground";
	const mobileLinkClass =
		"rounded-xl px-3 py-3 text-base font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground";

	return (
		<div className="fixed inset-x-0 top-0 z-40 px-3 pt-3 md:px-5 md:pt-4">
			<nav
				className={cn(
					"mx-auto max-w-6xl rounded-3xl border transition-all duration-300",
					scrolled || menuOpen
						? "border-border/70 bg-background/90 shadow-[0_8px_30px_hsl(222_47%_11%_/_0.08)] backdrop-blur-lg"
						: "border-transparent bg-transparent",
				)}
			>
				<div className="flex h-14 items-center justify-between pl-4 pr-2 md:h-16 md:pl-6 md:pr-3">
					<Link
						to="/"
						// shrink-0: the wordmark must never give way to the links —
						// measured in Bahasa, two extra links squeezed it to its mark.
						className="flex min-h-11 shrink-0 items-center"
						aria-label={m.nav_home()}
					>
						<Wordmark aspect="h-7 w-auto sm:h-8" priority />
					</Link>
					{/* Two groups, one rule: in-page anchors into the pitch, then the
					    three ROUTES a visitor can leave for — the price, the store
					    directory, the blog. The hairline IS the grouping, not
					    decoration; without it six labels read as one undifferentiated
					    run. `/cost` still isn't here (86eye3p6z) — the pricing teaser's
					    "full breakdown" row links it.

					    Two tiers, because the bar measurably cannot hold six labels at
					    every desktop width — this was measured, not estimated. At a
					    1024px viewport Bahasa needs 1107px for six labels plus the
					    action cluster and has 982px: it overruns by 125px
					    ("Penghantaran", "Pembayaran", "Soalan Lazim", "Mula percuma"),
					    and no trimming closes a gap that size — dropping the hairline,
					    tightening to px-2.5 and even cutting FAQ outright all still
					    overflow, and `min-h-11` is not negotiable. So `lg` carries the
					    three ROUTES (the places you cannot otherwise reach from here;
					    ~250px of slack even in Bahasa) and `xl` adds the anchors, which
					    are only scroll shortcuts into sections this page scrolls through
					    anyway and which all six locales fit by 1280px. Below `lg` the
					    menu carries all six, which is why the hamburger now switches at
					    `lg` too. */}
					<div className="hidden items-center gap-1 lg:flex">
						<div className="hidden items-center gap-1 xl:flex">
							{navLinks.map((link) => (
								<a key={link.href} href={link.href} className={linkClass}>
									{link.label}
								</a>
							))}
							<span aria-hidden className="mx-1.5 h-5 w-px bg-border" />
						</div>
						<Link to="/pricing" className={linkClass}>
							{m.nav_pricing()}
						</Link>
						<Link to="/stores" className={linkClass}>
							{m.nav_stores()}
						</Link>
						<a href={BLOG_URL} className={linkClass}>
							{m.nav_blog()}
						</a>
					</div>
					<div className="flex items-center gap-1">
						{/* Navigation ends, actions begin. Without this the 17px gap
						    between "Pricing" and the locale switcher was barely wider
						    than the ~6px gaps inside the cluster, so the bar read as one
						    undifferentiated run of nine controls. */}
						<span
							aria-hidden
							className="mx-2 hidden h-6 w-px bg-border lg:block"
						/>
						<LanguageSwitcher />
						<ThemeToggle variant="ghost" />
						<NavAuthCta />
						<Button
							type="button"
							variant="ghost"
							size="icon"
							className="tap-target rounded-full lg:hidden"
							onClick={() => setMenuOpen((prev) => !prev)}
							aria-label={menuOpen ? m.nav_menu_close() : m.nav_menu_open()}
							aria-expanded={menuOpen}
						>
							{menuOpen ? <X /> : <Menu />}
						</Button>
					</div>
				</div>
				{menuOpen && (
					<div className="border-t border-border/70 px-4 pb-4 pt-2 lg:hidden">
						<div className="flex flex-col gap-1">
							{navLinks.map((link) => (
								<a
									key={link.href}
									href={link.href}
									onClick={closeMenu}
									className={mobileLinkClass}
								>
									{link.label}
								</a>
							))}
							<Link
								to="/pricing"
								onClick={closeMenu}
								className={mobileLinkClass}
							>
								{m.nav_pricing()}
							</Link>
							{/* The two doors OUT of the seller pitch (z8r3fdkmyp) — the
							    store directory and the blog. Same order as the bar, so the
							    menu is the bar at a narrower width, not a second IA. */}
							<Link
								to="/stores"
								onClick={closeMenu}
								className={mobileLinkClass}
							>
								{m.nav_stores()}
							</Link>
							<a
								href={BLOG_URL}
								onClick={closeMenu}
								className={mobileLinkClass}
							>
								{m.nav_blog()}
							</a>
						</div>
						<div className="mt-3 flex flex-col gap-2 border-t border-border/70 pt-3">
							{/* `md:hidden`: from `md` up the bar already shows Log in and
							    the demo pill, so repeating them here would put the same
							    primary CTA on screen twice between `md` and `lg`. */}
							<div className="flex flex-col gap-2 md:hidden">
								<MobileMenuAuthCta onClose={closeMenu} />
							</div>
						</div>
					</div>
				)}
			</nav>
		</div>
	);
}
