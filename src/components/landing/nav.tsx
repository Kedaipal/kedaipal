import { useAuth } from "@clerk/tanstack-react-start";
import { Link } from "@tanstack/react-router";
import { ArrowRight, Globe, Menu, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { cn } from "../../lib/utils";
import { m } from "../../paraglide/messages";
import { getLocale, setLocale } from "../../paraglide/runtime";
import { Button } from "../ui/button";

function LanguageSwitcher() {
	const current = getLocale();
	const next = current === "ms" ? "en" : "ms";
	return (
		<Button
			type="button"
			variant="ghost"
			size="lg"
			onClick={() => setLocale(next)}
			aria-label={m.lang_switcher_label()}
			className="tap-target rounded-full"
		>
			<Globe />
			<span>{current === "ms" ? "EN" : "BM"}</span>
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
				className="hidden rounded-full px-5 md:inline-flex"
			>
				<Link to="/app">
					{m.nav_go_to_dashboard()}
					<ArrowRight />
				</Link>
			</Button>
		);
	}
	return (
		<>
			<Button
				asChild
				variant="ghost"
				size="lg"
				className="hidden rounded-full md:inline-flex"
			>
				<Link to="/sign-in/$" params={{ _splat: "" }}>
					{m.nav_sign_in()}
				</Link>
			</Button>
			<Button
				asChild
				size="lg"
				className="hidden rounded-full px-5 md:inline-flex"
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
	return (
		<div className="flex flex-col gap-2">
			<Button
				asChild
				variant="outline"
				size="lg"
				className="h-12 w-full rounded-full"
			>
				<Link to="/sign-in/$" params={{ _splat: "" }} onClick={onClose}>
					{m.nav_sign_in()}
				</Link>
			</Button>
			<Button asChild size="lg" className="h-12 w-full rounded-full">
				<Link to="/sign-up/$" params={{ _splat: "" }} onClick={onClose}>
					{m.nav_start_free()}
				</Link>
			</Button>
		</div>
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

	const linkClass =
		"whitespace-nowrap rounded-full px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground";
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
					<Link to="/" className="flex items-center" aria-label={m.nav_home()}>
						<img
							src="/logo-3.svg"
							alt="Kedaipal"
							className="h-7 w-auto sm:h-8"
						/>
					</Link>
					<div className="hidden items-center gap-1 md:flex">
						{navLinks.map((link) => (
							<a key={link.href} href={link.href} className={linkClass}>
								{link.label}
							</a>
						))}
						<Link to="/cost" className={linkClass}>
							{m.nav_cost()}
						</Link>
						<Link to="/pricing" className={linkClass}>
							{m.nav_pricing()}
						</Link>
					</div>
					<div className="flex items-center gap-1.5">
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
							<Link to="/cost" onClick={closeMenu} className={mobileLinkClass}>
								{m.nav_cost()}
							</Link>
							<Link
								to="/pricing"
								onClick={closeMenu}
								className={mobileLinkClass}
							>
								{m.nav_pricing()}
							</Link>
						</div>
						<div className="mt-3 border-t border-border/70 pt-3">
							<MobileMenuAuthCta onClose={closeMenu} />
						</div>
					</div>
				)}
			</nav>
		</div>
	);
}
