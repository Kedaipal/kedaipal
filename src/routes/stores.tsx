import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Search } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../../convex/_generated/api";
import { COUNTRY_LABELS, type Country } from "../../convex/lib/country";
import type { PublicShowcase } from "../../convex/showcases";
import { RegionToggle } from "../components/landing/landing-ui";
import { FoundingShelf } from "../components/marketplace/founding-shelf";
import {
	ShowcaseBand,
	ShowcaseDivider,
	ShowcaseStage,
} from "../components/marketplace/showcase-stage";
import { SponsoredCard } from "../components/marketplace/sponsored-card";
import { StoreCard } from "../components/marketplace/store-card";
import {
	StoresCompactHeader,
	useScrolledPast,
} from "../components/marketplace/stores-compact-header";
import { SectionHeading } from "../components/storefront/section-heading";
import { AppImage } from "../components/ui/app-image";
import { Button } from "../components/ui/button";
import { Skeleton } from "../components/ui/skeleton";
import { useLandingRegion } from "../hooks/useLandingRegion";
import { getConvexHttpClient, SITE_URL } from "../lib/convex-server";
import { jsonLdScript } from "../lib/json-ld";
import {
	filterStores,
	type MarketplaceChip,
	parseMarketplaceSearch,
	partitionStores,
	SEARCH_QUERY_MAX,
} from "../lib/marketplace";
import { joinShowcaseMembers, showcasesForRegion } from "../lib/showcase";
import { ssrRead } from "../lib/ssr-read";

/**
 * The marketplace home (z8r3fdkmyp) — kedaipal.com/stores, the buyer-facing
 * directory of every listed store: sponsored highlights (labelled), the
 * Founding 10 shelf, then the full searchable list. A buyer surface, so it
 * SSRs (the loader feeds head()'s meta + ItemList JSON-LD and the first
 * paint); the component re-reads the same query through the TanStack adapter
 * for the live view, the `$slug.tsx` posture exactly.
 *
 * Search + filter live in the URL (`?q=`, `?filter=`), so Back from a
 * storefront lands on the view the buyer left. The loader takes no deps from
 * them — filtering is client-side over one payload — and the canonical stays
 * the bare `/stores`.
 */

interface StoresLoaderData {
	/** Slug + name of every listed store, for the ItemList JSON-LD (capped). */
	stores: Array<{ slug: string; storeName: string }>;
	/** The showcase `?showcase=` names, when it is live — its title, tagline
	 * and cover feed the page's OG tags so the booth-QR link unfurls as the
	 * event in WhatsApp (z8r3fdr6mv). Absent for the plain page or a slug
	 * that is not live. */
	focusedShowcase?: Pick<PublicShowcase, "title" | "tagline" | "coverImageUrl">;
}

const JSON_LD_STORE_CAP = 50;
const PAGE_SIZE = 24;

const PAGE_TITLE = "Discover stores — Kedaipal";
const PAGE_DESCRIPTION =
	"Browse real sellers on Kedaipal — find a store, order on their page, confirmed over WhatsApp.";

export const Route = createFileRoute("/stores")({
	validateSearch: parseMarketplaceSearch,
	// The focused showcase is the one search param the loader reads — for the
	// OG tags only. Search and filter stay client-side over the one payload.
	loaderDeps: ({ search }) => ({ showcase: search.showcase }),
	loader: async ({ deps }): Promise<StoresLoaderData | null> => {
		const client = getConvexHttpClient();
		// Soft-degrade like every buyer loader (86eyheqzv): a transient upstream
		// failure renders the shell and the client query paints the directory.
		const read = await ssrRead(() => client.query(api.marketplace.listStores));
		if (!read.ok) return null;
		const showcases = deps.showcase
			? await ssrRead(() => client.query(api.showcases.listShowcases))
			: null;
		const focused = showcases?.ok
			? showcases.value.find((s) => s.slug === deps.showcase)
			: undefined;
		return {
			stores: read.value
				.slice(0, JSON_LD_STORE_CAP)
				.map(({ slug, storeName }) => ({ slug, storeName })),
			...(focused
				? {
						focusedShowcase: {
							title: focused.title,
							tagline: focused.tagline,
							coverImageUrl: focused.coverImageUrl,
						},
					}
				: {}),
		};
	},
	head: ({ loaderData }) => {
		const canonicalUrl = `${SITE_URL}/stores`;
		const focused = loaderData?.focusedShowcase;
		// A shared showcase link unfurls as the EVENT ("Malaysia Campfest 2026
		// on Kedaipal"), cover and all; the canonical stays the bare directory.
		const title = focused ? `${focused.title} on Kedaipal` : PAGE_TITLE;
		const description = focused?.tagline ?? PAGE_DESCRIPTION;
		const meta = [
			{ title },
			{ name: "description", content: description },
			{ name: "robots", content: "index, follow" },
			{ property: "og:type", content: "website" },
			{ property: "og:site_name", content: "Kedaipal" },
			{ property: "og:title", content: title },
			{ property: "og:description", content: description },
			{ property: "og:url", content: canonicalUrl },
			...(focused?.coverImageUrl
				? [{ property: "og:image", content: focused.coverImageUrl }]
				: []),
			{
				name: "twitter:card",
				content: focused?.coverImageUrl ? "summary_large_image" : "summary",
			},
			{ name: "twitter:title", content: title },
			{ name: "twitter:description", content: description },
		];
		const scripts =
			loaderData && loaderData.stores.length > 0
				? [
						jsonLdScript({
							"@context": "https://schema.org",
							"@type": "ItemList",
							name: PAGE_TITLE,
							itemListElement: loaderData.stores.map((store, i) => ({
								"@type": "ListItem",
								position: i + 1,
								name: store.storeName,
								url: `${SITE_URL}/${store.slug}`,
							})),
						}),
					]
				: [];
		return {
			meta,
			links: [{ rel: "canonical", href: canonicalUrl }],
			scripts,
		};
	},
	component: MarketplacePage,
});

const CHIPS: Array<{ id: MarketplaceChip; label: string; dot?: boolean }> = [
	{ id: "all", label: "All stores" },
	{ id: "open", label: "Open now", dot: true },
	{ id: "new", label: "New this month" },
	{ id: "delivers", label: "Delivers" },
];

/** A horizontal rail that snaps: `scroll-px-*` matches the gutter, or
 * `snap-start` pulls the first card flush to the screen edge on load. */
const RAIL_CLASS =
	"flex snap-x gap-3 overflow-x-auto scrollbar-none scroll-px-5 px-5 pb-1 lg:scroll-px-8 lg:px-8";

function MarketplacePage() {
	const cards = useQuery(convexQuery(api.marketplace.listStores, {})).data;
	const showcases = useQuery(convexQuery(api.showcases.listShowcases, {})).data;
	const [region, setRegion] = useLandingRegion();
	const { q, filter, showcase: focusedSlug } = Route.useSearch();
	// The compact header takes over once the hero's chips scroll out above.
	const [heroEndRef, scrolledPast] = useScrolledPast<HTMLDivElement>();
	const navigate = Route.useNavigate();
	const chip: MarketplaceChip = filter ?? "all";
	// The input's own buffer, seeded from the URL. The URL is written on every
	// keystroke (replace, so typing never floods history); it isn't read back
	// mid-typing, which would fight the caret while a navigation settles.
	const [search, setSearchBuffer] = useState(q ?? "");
	const [shown, setShown] = useState(PAGE_SIZE);

	function setSearch(next: string) {
		setSearchBuffer(next);
		void navigate({
			search: (prev) => ({ ...prev, q: next.trim() ? next : undefined }),
			replace: true,
		});
	}
	function setChip(next: MarketplaceChip) {
		void navigate({
			search: (prev) => ({
				...prev,
				filter: next === "all" ? undefined : next,
			}),
			replace: true,
		});
	}

	// Minute tick so "Open now" flips live — the opening-hours-line pattern.
	const [, setTick] = useState(0);
	useEffect(() => {
		const timer = setInterval(() => setTick((t) => t + 1), 60_000);
		return () => clearInterval(timer);
	}, []);
	const now = Date.now();

	// A new search/filter/region is a new list — pagination starts over.
	// Derived-in-render (never an effect): remember what we last sliced FOR.
	const [slicedFor, setSlicedFor] = useState({ search, chip, region });
	if (
		slicedFor.search !== search ||
		slicedFor.chip !== chip ||
		slicedFor.region !== region
	) {
		setSlicedFor({ search, chip, region });
		setShown(PAGE_SIZE);
	}

	// No memo: the list is small (low hundreds) and `now` moves every render
	// anyway — a dependency-perfect memo would never hit.
	const regionCards = cards
		? filterStores(cards, { region, chip: "all", search: "", now })
		: [];
	const visible = cards
		? filterStores(cards, { region, chip, search, now })
		: [];
	const { sponsored, founding } = partitionStores(regionCards);
	const refined = search.trim().length > 0 || chip !== "all";
	// Showcases (z8r3fdr6mv): live ones for this region, each member joined
	// to its directory card. Regions never blend here either. Ones with no
	// joinable member render nothing (a banner with no stores is a dead end).
	const regionShowcases = showcases
		? showcasesForRegion(showcases, region)
				.map((s) => ({
					showcase: s,
					tickets: joinShowcaseMembers(s, regionCards),
				}))
				.filter((s) => s.tickets.length > 0)
		: [];
	const focused = focusedSlug
		? regionShowcases.find((s) => s.showcase.slug === focusedSlug)
		: undefined;
	// A focused link to a showcase that is no longer live (ended, unpublished,
	// or in the other region) lands on the plain page with a one-line why —
	// a printed QR outlives an event, and the buyer who scans it deserves a
	// sentence, not a silently ordinary page.
	const focusedMissing =
		focusedSlug !== undefined && showcases !== undefined && !focused;
	const [stageShowcase, ...bandShowcases] = focused
		? regionShowcases.filter((s) => s !== focused)
		: regionShowcases;
	function leaveShowcase() {
		void navigate({
			search: (prev) => ({ ...prev, showcase: undefined }),
			replace: true,
		});
	}
	// An empty REGION carries its own "be the first" CTA; the band below it
	// would repeat the identical button, so it steps aside (one ask, once).
	const regionEmpty = !refined && visible.length === 0;

	return (
		<div className="flex min-h-dvh w-full flex-col bg-background">
			{/* The landing's mint mesh runs edge to edge; the content inside it
			    keeps the page column. Nav through chips ride it. */}
			<div className="bg-hero-mesh pb-4">
				<div className="mx-auto w-full max-w-6xl">
					<header className="flex items-center justify-between gap-3 px-5 py-3.5 lg:px-8">
						<Link to="/" aria-label="Kedaipal home">
							<AppImage
								src="/logo-3.svg"
								alt="Kedaipal"
								aspect="h-7 w-auto"
								fill={false}
								priority
							/>
						</Link>
						<div className="flex items-center gap-2.5">
							<RegionToggle region={region} onChange={setRegion} />
							{/* One seller CTA up here — "learn" and "sign up" land on the
							    same funnel, so two adjacent buttons would be noise; the
							    footer's "For sellers" is the quiet path to the pitch. Navy,
							    not mint: on a buyer page the buyer's search owns the
							    action colour and the seller ask sits a rung below. */}
							<Button
								asChild
								className="tap-target hidden bg-primary px-4 font-bold text-primary-foreground hover:bg-primary/90 sm:inline-flex"
							>
								<Link to="/app">Open your store</Link>
							</Button>
						</div>
					</header>

					{/* A booth-QR landing (`?showcase=`) is about the EVENT: the hero's
					    pitch, search and chips step aside and the showcase is the first
					    thing on screen. "All stores" on the stage brings them back.
					    Judged on the slug alone so the hero doesn't flash in while the
					    showcases load, and returns if the slug turns out not to be live. */}
					{focusedSlug !== undefined && !focusedMissing ? null : (
						<>
							<div className="flex flex-col items-center px-5 pt-5 text-center lg:pt-8">
								<AppImage
									src="/logo.svg"
									alt=""
									aspect="h-12 w-auto lg:h-14"
									fill={false}
									priority
								/>
								<h1 className="tracking-display mt-3 font-heading text-[25px] font-extrabold leading-tight lg:text-[2.6rem]">
									Find your next{" "}
									<span className="kp-highlight text-accent">
										favourite store
									</span>
								</h1>
								<p className="mt-2 max-w-md text-sm leading-relaxed text-muted-foreground lg:max-w-xl lg:text-[15px]">
									Browse real sellers on Kedaipal — order on their store,
									confirmed over WhatsApp.
								</p>
							</div>

							{/* <search> is the semantic landmark; the inner form keeps Enter
					    from navigating (search is live-as-you-type). */}
							<search className="mt-4 flex justify-center px-5">
								<form
									className="flex w-full justify-center"
									onSubmit={(e) => e.preventDefault()}
								>
									<div className="flex h-12 w-full max-w-xl items-center gap-2.5 rounded-full border border-border bg-card pl-5 pr-1.5 shadow-sm transition-shadow focus-within:ring-3 focus-within:ring-ring/40">
										<input
											type="search"
											value={search}
											onChange={(e) => setSearch(e.target.value)}
											placeholder="Search stores…"
											aria-label="Search stores"
											maxLength={SEARCH_QUERY_MAX}
											className="min-w-0 grow bg-transparent text-sm outline-none placeholder:text-muted-foreground/70"
										/>
										<button
											type="submit"
											aria-label="Search"
											className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground transition-colors hover:bg-accent/90"
										>
											<Search className="size-4" />
										</button>
									</div>
								</form>
							</search>

							<div className="mt-3.5 flex gap-2 overflow-x-auto scrollbar-none px-5 lg:justify-center">
								{CHIPS.map(({ id, label, dot }) => {
									const active = chip === id;
									return (
										<button
											key={id}
											type="button"
											aria-pressed={active}
											onClick={() => setChip(id)}
											className={`tap-target flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-xs font-semibold transition-colors ${
												active
													? "bg-primary text-primary-foreground"
													: "border border-border bg-card text-foreground hover:bg-muted"
											}`}
										>
											{dot ? (
												<span
													aria-hidden
													className="size-1.5 rounded-full bg-accent"
												/>
											) : null}
											{label}
										</button>
									);
								})}
							</div>
						</>
					)}
				</div>
			</div>

			{/* Zero-height sentinel: the compact header is live once this has
			    scrolled out above the viewport. */}
			<div ref={heroEndRef} aria-hidden className="h-px w-full" />
			<StoresCompactHeader
				visible={scrolledPast}
				search={search}
				onSearch={setSearch}
				chip={chip}
				chips={CHIPS}
				onChip={setChip}
				region={region}
				onRegion={setRegion}
				maxLength={SEARCH_QUERY_MAX}
			/>

			<div className="mx-auto flex w-full max-w-6xl grow flex-col">
				{cards === undefined ? (
					<MarketplaceSkeleton />
				) : (
					<main className="flex flex-col">
						{focused ? (
							<div className="mt-5">
								<ShowcaseStage
									showcase={focused.showcase}
									tickets={focused.tickets}
									now={now}
									mode="focused"
									railClassName={RAIL_CLASS}
									onBack={leaveShowcase}
								/>
							</div>
						) : null}
						{focusedMissing ? (
							<p className="mx-5 mt-5 rounded-2xl border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground lg:mx-8">
								That showcase isn't on right now — here's every store on
								Kedaipal instead.
							</p>
						) : null}
						{!refined && stageShowcase ? (
							<section
								aria-label="Happening now"
								className="mt-5 flex flex-col gap-3"
							>
								{focused ? (
									// The focused view's own showcase is above; everything
									// here is the OTHER ones, so they are all bands.
									<ShowcaseDivider label="More happening now" />
								) : (
									<div className="px-5 lg:px-8">
										<SectionHeading title="Happening now" />
									</div>
								)}
								{focused ? (
									<ShowcaseBand
										showcase={stageShowcase.showcase}
										tickets={stageShowcase.tickets}
										now={now}
									/>
								) : (
									<ShowcaseStage
										showcase={stageShowcase.showcase}
										tickets={stageShowcase.tickets}
										now={now}
										mode="stage"
										railClassName={RAIL_CLASS}
									/>
								)}
								{!focused && bandShowcases.length > 0 ? (
									<ShowcaseDivider label="More happening now" />
								) : null}
								{bandShowcases.map((s) => (
									<ShowcaseBand
										key={s.showcase.slug}
										showcase={s.showcase}
										tickets={s.tickets}
										now={now}
									/>
								))}
							</section>
						) : null}
						{!refined && sponsored.length > 0 ? (
							<section className="mt-7 flex flex-col gap-3">
								<div className="px-5 lg:px-8">
									<SectionHeading
										title="Store highlights"
										context="Sponsored placements"
									/>
								</div>
								<div
									className={`${RAIL_CLASS} lg:grid lg:grid-cols-3 lg:overflow-visible`}
								>
									{sponsored.map((card) => (
										<SponsoredCard
											key={card.slug}
											card={card}
											now={now}
											className="w-[85vw] max-w-[340px] shrink-0 snap-start lg:w-auto lg:max-w-none"
										/>
									))}
								</div>
							</section>
						) : null}

						{!refined ? (
							<FoundingShelf
								stores={founding}
								className="mt-7"
								railClassName={RAIL_CLASS}
							/>
						) : null}

						<section className="mt-7 flex flex-col">
							<div className="px-5 lg:px-8">
								<SectionHeading
									title={refined ? "Results" : "All stores"}
									context={`${visible.length} ${visible.length === 1 ? "store" : "stores"} · ${COUNTRY_LABELS[region]}`}
								/>
							</div>
							{visible.length === 0 ? (
								<EmptyState
									region={region}
									refined={refined}
									onClear={() => {
										setSearchBuffer("");
										void navigate({ search: {}, replace: true });
									}}
								/>
							) : (
								<>
									{/* Mobile: divided rows. Desktop: a 4-up card grid. Same
									    StoreCard, two variants — one idea, one control. */}
									<div className="mt-1 flex flex-col divide-y divide-border/60 lg:hidden">
										{visible.slice(0, shown).map((card) => (
											<StoreCard
												key={card.slug}
												card={card}
												variant="row"
												now={now}
											/>
										))}
									</div>
									<div className="mt-3 hidden lg:grid lg:grid-cols-4 lg:gap-4 lg:px-8">
										{visible.slice(0, shown).map((card) => (
											<StoreCard
												key={card.slug}
												card={card}
												variant="grid"
												now={now}
											/>
										))}
									</div>
									{visible.length > shown ? (
										<div className="mt-4 flex justify-center px-5">
											<Button
												type="button"
												variant="secondary"
												className="tap-target w-full max-w-xs font-bold"
												onClick={() => setShown((n) => n + PAGE_SIZE)}
											>
												Show {Math.min(PAGE_SIZE, visible.length - shown)} more
												stores
											</Button>
										</div>
									) : null}
								</>
							)}
						</section>

						{regionEmpty ? null : <SellerCtaBand />}
					</main>
				)}

				{/* Mobile: links then ©. Desktop (the mock): © left, links right. */}
				<footer className="mt-auto flex flex-col gap-1 px-5 py-6 text-xs text-muted-foreground lg:flex-row-reverse lg:items-center lg:justify-between lg:px-8 lg:py-7">
					<nav className="flex gap-4">
						<Link to="/" className={FOOTER_LINK_CLASS}>
							For sellers
						</Link>
						<Link to="/pricing" className={FOOTER_LINK_CLASS}>
							Pricing
						</Link>
						<Link to="/privacy" className={FOOTER_LINK_CLASS}>
							Privacy
						</Link>
						<Link to="/terms" className={FOOTER_LINK_CLASS}>
							Terms
						</Link>
					</nav>
					<span className="text-muted-foreground/80">
						© {new Date().getFullYear()} Kedaipal
					</span>
				</footer>
			</div>
		</div>
	);
}

/** 44px tall on touch (design-system §mobile); the row stays one line. */
const FOOTER_LINK_CLASS =
	"inline-flex min-h-11 items-center hover:text-foreground lg:min-h-0";

/**
 * Zero results, two different stories: a refined view that filtered everything
 * out offers the way back (clear); an empty REGION is an acquisition moment,
 * not a dead end — the one place "be the first" is literally true.
 */
function EmptyState({
	region,
	refined,
	onClear,
}: {
	region: Country;
	refined: boolean;
	onClear: () => void;
}) {
	if (refined) {
		return (
			<div className="flex flex-col items-center gap-3 px-5 py-12 text-center">
				<p className="text-sm font-semibold">No stores match</p>
				<p className="text-xs text-muted-foreground">
					Try a different name, or clear the search and filters.
				</p>
				<Button
					type="button"
					variant="secondary"
					className="tap-target font-bold"
					onClick={onClear}
				>
					Clear search &amp; filters
				</Button>
			</div>
		);
	}
	return (
		<div className="flex flex-col items-center gap-3 px-5 py-12 text-center">
			<p className="text-sm font-semibold">
				No {COUNTRY_LABELS[region]} stores listed yet
			</p>
			<p className="max-w-xs text-xs text-muted-foreground">
				Selling from {COUNTRY_LABELS[region]}? Open your store and be the first
				one buyers find here.
			</p>
			<Button asChild className="tap-target px-4 font-bold">
				<Link to="/app">Open your store — start free</Link>
			</Button>
		</div>
	);
}

function SellerCtaBand() {
	return (
		<section className="mx-5 mt-9 flex flex-col gap-4 rounded-2xl bg-cta-mesh p-6 lg:mx-8 lg:flex-row lg:items-center lg:justify-between lg:p-8">
			<div>
				<h2 className="font-heading text-lg font-extrabold text-cta-mesh-foreground lg:text-xl">
					Selling on WhatsApp?
				</h2>
				<p className="mt-1.5 max-w-md text-[13px] leading-relaxed text-cta-mesh-foreground/70">
					Get your own store link, order inbox and payment tracking — and get
					listed here, free.
				</p>
			</div>
			{/* "start free", not "free": the house promise is "Start free — pay
			    when you sell" (messages/en.json), and the button must not
			    outrun it. */}
			<Button asChild className="tap-target shrink-0 px-5 font-bold">
				<Link to="/app">Open your store — start free</Link>
			</Button>
		</section>
	);
}

function MarketplaceSkeleton() {
	return (
		<main className="flex flex-col gap-7 pt-7">
			<div className="flex flex-col gap-3 px-5 lg:px-8">
				<Skeleton className="h-4 w-32" />
				<Skeleton className="h-56 w-full max-w-[340px] rounded-2xl lg:max-w-none" />
			</div>
			<div className="flex flex-col gap-1 px-5 lg:px-8">
				<Skeleton className="h-4 w-24" />
				{[0, 1, 2, 3, 4].map((n) => (
					<div key={n} className="flex items-center gap-3 py-3.5">
						<Skeleton className="size-12 rounded-[14px]" />
						<div className="flex grow flex-col gap-1.5">
							<Skeleton className="h-4 w-40" />
							<Skeleton className="h-3 w-56" />
						</div>
					</div>
				))}
			</div>
		</main>
	);
}
