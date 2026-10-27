import { Link } from "@tanstack/react-router";
import { Search, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { MarketplaceChip } from "../../lib/marketplace";
import { cn } from "../../lib/utils";
import { AppImage } from "../ui/app-image";
import { Button } from "../ui/button";
import { ThemeToggle } from "../ui/theme-toggle";
import { Wordmark } from "../ui/wordmark";

/**
 * /stores' compact header (z8r3fdr6mv): once the hero scrolls past, a
 * frosted bar takes over with the logo and a floating search — on desktop the filter chips too, and the seller CTA. The hero's
 * own search and chips are the same STATE; this bar is a second view of it,
 * not a second control, so typing in either moves the other.
 *
 * On a phone an active filter rides inside the search pill as a removable
 * token, so the bar stays one row; desktop has the width for the chips.
 *
 * `docked` is the booth-QR view (`?showcase=`), where the hero — and its
 * search — is not rendered: the bar IS the page header there, so it sits in
 * the flow (sticky, nothing under it to cover) and never hides. Keying it on
 * "has the buyer refined" instead slid the bar away the moment they cleared
 * the last character, with the input still focused.
 */
export function StoresCompactHeader({
	visible,
	docked = false,
	search,
	onSearch,
	chip,
	chips,
	onChip,
	maxLength,
	placeholder,
}: {
	visible: boolean;
	/** The page's header, not a takeover: always shown, sticky in the flow. */
	docked?: boolean;
	search: string;
	onSearch: (next: string) => void;
	chip: MarketplaceChip;
	chips: ReadonlyArray<{ id: MarketplaceChip; label: string }>;
	onChip: (next: MarketplaceChip) => void;
	maxLength: number;
	/** The bar's hint — `storeSearchPlaceholder(...).compact`. */
	placeholder: string;
}) {
	const activeChip = chips.find((c) => c.id === chip && c.id !== "all");
	const shown = docked || visible;
	return (
		<div
			aria-hidden={!shown}
			className={cn(
				"top-0 z-30 border-b border-border/80 bg-background/85 shadow-[0_8px_24px_-16px_color-mix(in_oklab,var(--foreground)_35%,transparent)] backdrop-blur-xl",
				docked
					? "sticky"
					: cn(
							"fixed inset-x-0 transition-[translate,opacity] duration-200 ease-out motion-reduce:transition-none",
							visible
								? "translate-y-0 opacity-100"
								: "pointer-events-none -translate-y-full opacity-0",
						),
			)}
		>
			<div className="mx-auto flex w-full max-w-6xl items-center gap-2.5 px-3 py-2 lg:gap-5 lg:px-8 lg:py-2.5">
				<Link
					to="/"
					aria-label="Kedaipal home"
					tabIndex={shown ? undefined : -1}
					className="flex size-11 shrink-0 items-center justify-center rounded-xl lg:size-auto lg:px-0"
				>
					<AppImage
						src="/logo.svg"
						alt=""
						aspect="h-7 w-auto lg:hidden"
						fill={false}
					/>
					<span className="hidden lg:block">
						<Wordmark aspect="h-6 w-auto" />
					</span>
				</Link>

				<form
					className="flex min-w-0 grow justify-start lg:grow-0 lg:basis-[440px]"
					onSubmit={(e) => e.preventDefault()}
				>
					<div className="flex h-11 w-full min-w-0 items-center gap-2 rounded-full border border-border bg-card pl-3.5 pr-1.5 shadow-sm transition-shadow focus-within:ring-3 focus-within:ring-ring/40">
						<Search
							aria-hidden
							className="size-4 shrink-0 text-muted-foreground"
						/>
						<input
							type="search"
							value={search}
							onChange={(e) => onSearch(e.target.value)}
							placeholder={placeholder}
							aria-label="Search stores"
							maxLength={maxLength}
							tabIndex={shown ? undefined : -1}
							className="min-w-0 grow bg-transparent text-sm outline-none placeholder:text-muted-foreground/70"
						/>
						{activeChip ? (
							<button
								type="button"
								onClick={() => onChip("all")}
								tabIndex={shown ? undefined : -1}
								aria-label={`Clear the ${activeChip.label} filter`}
								className="flex h-8 shrink-0 items-center gap-1 rounded-full bg-primary pl-2.5 pr-1.5 text-[11.5px] font-bold text-primary-foreground lg:hidden"
							>
								{activeChip.label}
								<span className="flex size-5 items-center justify-center rounded-full bg-primary-foreground/20">
									<X aria-hidden className="size-3" />
								</span>
							</button>
						) : null}
					</div>
				</form>

				<div className="hidden gap-1.5 lg:flex">
					{chips.map((c) => {
						const active = chip === c.id;
						return (
							<button
								key={c.id}
								type="button"
								aria-pressed={active}
								onClick={() => onChip(c.id)}
								tabIndex={shown ? undefined : -1}
								className={cn(
									"flex h-9 shrink-0 items-center rounded-full px-3.5 text-xs font-semibold transition-colors",
									active
										? "bg-primary text-primary-foreground"
										: "border border-border bg-card text-foreground hover:bg-muted",
								)}
							>
								{c.label}
							</button>
						);
					})}
				</div>

				<div className="ml-auto flex shrink-0 items-center gap-2.5">
					<ThemeToggle variant="ghost" />
					<Button
						asChild
						className="tap-target hidden bg-primary px-4 font-bold text-primary-foreground hover:bg-primary/90 lg:inline-flex"
					>
						<Link to="/app" tabIndex={shown ? undefined : -1}>
							Open your store
						</Link>
					</Button>
				</div>
			</div>
		</div>
	);
}

/**
 * True once the element has scrolled out above the viewport — the moment
 * the compact header should take over. One observer, no scroll listener,
 * and `false` on the server so SSR and the first client paint agree.
 */
export function useScrolledPast<T extends Element>(): [
	React.RefObject<T | null>,
	boolean,
] {
	const ref = useRef<T | null>(null);
	const [past, setPast] = useState(false);
	useEffect(() => {
		const el = ref.current;
		if (!el || typeof IntersectionObserver === "undefined") return;
		const observer = new IntersectionObserver(
			([entry]) => {
				// Out of view AND above: scrolled past, not merely below the fold.
				setPast(!entry.isIntersecting && entry.boundingClientRect.top < 0);
			},
			{ threshold: 0 },
		);
		observer.observe(el);
		return () => observer.disconnect();
	}, []);
	return [ref, past];
}
