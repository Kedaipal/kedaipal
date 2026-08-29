import { useAuth } from "@clerk/tanstack-react-start";
import { Link } from "@tanstack/react-router";
import { ArrowRight, Check, Globe, Menu, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { Locale } from "../../../convex/lib/locale";
import { useSupportWaNumber } from "../../hooks/useSupportWaNumber";
import { buildWaContactLink } from "../../lib/contact";
import { cn } from "../../lib/utils";
import { m } from "../../paraglide/messages";
import { getLocale, locales, setLocale } from "../../paraglide/runtime";
import { WhatsAppIcon } from "../dashboard/brand-icons";
import { AppImage } from "../ui/app-image";
import { Button } from "../ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";

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

/**
 * WhatsApp deep-link to Kedaipal's support number, prefilled with a demo
 * request — never a filled/accent pill (86eye3p6z §C: exactly one primary
 * button per page), so it rides the `outline` treatment.
 *
 * **Mobile menu only.** It used to sit in the desktop bar too, which put four
 * controls in the right cluster (locale, demo, log-in, trial) and read as
 * clutter (owner, 29 Aug), so the bar now keeps only the locale utility,
 * `Log in` and the one mint pill — the same reasoning that moved the cost
 * calculator out of it. The intent did not lose its home: it moved UP, to an
 * outline pill beside the hero's primary CTA (`hero.tsx`), and still closes
 * the page in `final-cta.tsx` and `/pricing`.
 */
function BookDemoLink({ className }: { className?: string }) {
	const supportWa = useSupportWaNumber();
	return (
		<Button asChild variant="outline" size="lg" className={className}>
			<a
				href={buildWaContactLink(m.demo_wa_message(), supportWa)}
				target="_blank"
				rel="noopener noreferrer"
			>
				<WhatsAppIcon className="size-4" />
				{m.book_demo_cta()}
			</a>
		</Button>
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
	// 86eye3p6z §C bounds the number of PRIMARY buttons, not the number of
	// doors. Log-in used to be omitted entirely on that reading, which left a
	// returning paying seller with no way into their own dashboard except to
	// click "start a trial" and hunt for Clerk's own "already have an account?"
	// link — the one visitor we least want to send through the signup door.
	// A text link is a rung below the outline "Book a demo" in the hierarchy,
	// so the mint trial pill is still the only thing that reads as the ask.
	return (
		<>
			<Link
				to="/sign-in/$"
				params={{ _splat: "" }}
				className="hidden min-h-11 items-center whitespace-nowrap rounded-full px-4 text-sm font-semibold text-foreground transition-colors hover:bg-muted md:inline-flex"
			>
				{m.nav_log_in()}
			</Link>
			<Button
				asChild
				size="lg"
				className="tap-target hidden rounded-full px-5 md:inline-flex"
			>
				<Link to="/sign-up/$" params={{ _splat: "" }}>
					{m.nav_start_free()}
				</Link>
			</Button>
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
	// Log-in sits ABOVE "Book a demo": a returning seller opening this menu is
	// a far more common intent than a sales conversation, and on mobile the
	// order in the stack IS the priority signal.
	return (
		<>
			<Button asChild size="lg" className="h-12 w-full rounded-full">
				<Link to="/sign-up/$" params={{ _splat: "" }} onClick={onClose}>
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

	const navLinks = [
		{ href: "/#features", label: m.nav_features() },
		{ href: "/#how", label: m.nav_how() },
		{ href: "/#faq", label: m.nav_faq() },
	];

	// `inline-flex` + `min-h-11`, not `py-2`: the bar mixes links, ghost buttons
	// and pills, and only an explicit shared height keeps their hover pills from
	// rendering at three different sizes in one row.
	const linkClass =
		"inline-flex min-h-11 items-center whitespace-nowrap rounded-full px-4 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground";
	const mobileLinkClass =
		"rounded-xl px-3 py-3 text-base font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground";

	return (
		<div className="fixed inset-x-0 top-0 z-40 px-3 pt-3 md:px-5 md:pt-4">
			<nav
				className={cn(
					"mx-auto max-w-5xl rounded-3xl border transition-all duration-300",
					scrolled || menuOpen
						? "border-border/70 bg-background/90 shadow-[0_8px_30px_hsl(222_47%_11%_/_0.08)] backdrop-blur-lg"
						: "border-transparent bg-transparent",
				)}
			>
				<div className="flex h-14 items-center justify-between pl-4 pr-2 md:h-16 md:pl-6 md:pr-3">
					<Link
						to="/"
						className="flex min-h-11 items-center"
						aria-label={m.nav_home()}
					>
						<AppImage
							src="/logo-3.svg"
							alt="Kedaipal"
							aspect="h-7 w-auto sm:h-8"
							fill={false}
							priority
						/>
					</Link>
					{/* The cost calculator left the nav (86eye3p6z): five links plus the
					    locale switcher and the CTA crowded the bar between md and ~lg,
					    and `/cost` now has a better front door — the money-math block's
					    own CTA, where a visitor is already thinking about the number. */}
					<div className="hidden items-center gap-1 md:flex">
						{navLinks.map((link) => (
							<a key={link.href} href={link.href} className={linkClass}>
								{link.label}
							</a>
						))}
						<Link to="/pricing" className={linkClass}>
							{m.nav_pricing()}
						</Link>
					</div>
					<div className="flex items-center gap-1">
						{/* Navigation ends, actions begin. Without this the 17px gap
						    between "Pricing" and the locale switcher was barely wider
						    than the ~6px gaps inside the cluster, so the bar read as one
						    undifferentiated run of nine controls. */}
						<span
							aria-hidden
							className="mx-2 hidden h-6 w-px bg-border md:block"
						/>
						<LanguageSwitcher />
						<NavAuthCta />
						<Button
							type="button"
							variant="ghost"
							size="icon"
							className="tap-target rounded-full md:hidden"
							onClick={() => setMenuOpen((prev) => !prev)}
							aria-label={menuOpen ? m.nav_menu_close() : m.nav_menu_open()}
							aria-expanded={menuOpen}
						>
							{menuOpen ? <X /> : <Menu />}
						</Button>
					</div>
				</div>
				{menuOpen && (
					<div className="border-t border-border/70 px-4 pb-4 pt-2 md:hidden">
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
						</div>
						<div className="mt-3 flex flex-col gap-2 border-t border-border/70 pt-3">
							<MobileMenuAuthCta onClose={closeMenu} />
							<BookDemoLink className="h-12 w-full rounded-full" />
						</div>
					</div>
				)}
			</nav>
		</div>
	);
}
