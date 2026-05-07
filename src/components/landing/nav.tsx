import { useAuth } from "@clerk/tanstack-react-start";
import { Link } from "@tanstack/react-router";
import { ArrowRight, Globe, Menu, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
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
			<Button asChild size="lg">
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
				className="hidden md:inline-flex"
			>
				<Link to="/sign-in/$" params={{ _splat: "" }}>
					{m.nav_sign_in()}
				</Link>
			</Button>
			<Button asChild size="lg">
				<Link to="/sign-up/$" params={{ _splat: "" }}>
					{m.nav_start_free()}
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
			setScrolled(window.scrollY > 64);
		}
		window.addEventListener("scroll", onScroll, { passive: true });
		return () => window.removeEventListener("scroll", onScroll);
	}, []);

	const navLinks = [
		{ href: "#features", label: m.nav_features() },
		{ href: "#how", label: m.nav_how() },
		{ href: "#pricing", label: m.nav_pricing() },
		{ href: "#faq", label: m.nav_faq() },
	];

	return (
		<nav
			className={`sticky top-0 z-40 w-full transition-all duration-300 ${
				scrolled || menuOpen
					? "border-b border-border/60 bg-background/95 shadow-sm backdrop-blur-lg"
					: "border-b border-transparent bg-transparent"
			}`}
		>
			<div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5 md:px-8">
				<a href="#top" className="flex items-center">
					<img src="/logo-3.svg" alt="Kedaipal" className="h-9 w-auto" />
				</a>
				<div className="hidden items-center gap-8 md:flex">
					{navLinks.map((link) => (
						<a
							key={link.href}
							href={link.href}
							className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
						>
							{link.label}
						</a>
					))}
				</div>
				<div className="flex items-center gap-2">
					<LanguageSwitcher />
					<NavAuthCta />
					<Button
						type="button"
						variant="ghost"
						size="lg"
						className="md:hidden"
						onClick={() => setMenuOpen((prev) => !prev)}
						aria-label={menuOpen ? m.nav_menu_close() : m.nav_menu_open()}
						aria-expanded={menuOpen}
					>
						{menuOpen ? <X /> : <Menu />}
					</Button>
				</div>
			</div>
			{menuOpen && (
				<div className="border-t border-border/60 bg-background px-5 pb-4 pt-2 md:hidden">
					<div className="flex flex-col gap-1">
						{navLinks.map((link) => (
							<a
								key={link.href}
								href={link.href}
								onClick={closeMenu}
								className="rounded-lg px-3 py-3 text-base font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
							>
								{link.label}
							</a>
						))}
					</div>
				</div>
			)}
		</nav>
	);
}
