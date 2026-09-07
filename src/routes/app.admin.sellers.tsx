import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation } from "convex/react";
import {
	Award,
	ChevronRight,
	ShieldCheck,
	ShieldX,
	Store,
	Trash2,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "../../convex/_generated/api";
import type { AdminSellerRow } from "../../convex/admin";
import { PageHeader } from "../components/dashboard/page-header";
import { ConfirmDialog } from "../components/ui/confirm-dialog";
import { Input } from "../components/ui/input";
import { Skeleton } from "../components/ui/skeleton";
import { useActAs } from "../hooks/useActAs";
import { convexErrorMessage } from "../lib/format";

export const Route = createFileRoute("/app/admin/sellers")({
	component: AdminSellersRoute,
});

function AdminSellersRoute() {
	// Client gate is cosmetic — `listSellersForAdmin` is `requireAdmin` server-side.
	const isAdmin = useQuery(convexQuery(api.billing.amIAdmin, {})).data;

	if (isAdmin === undefined) {
		return (
			<div className="flex flex-col gap-4 lg:max-w-3xl">
				<Skeleton className="h-7 w-40" />
				<Skeleton className="h-24 w-full rounded-2xl" />
				<Skeleton className="h-24 w-full rounded-2xl" />
			</div>
		);
	}
	if (!isAdmin) {
		return (
			<div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border px-6 py-16 text-center">
				<ShieldX className="size-8 text-muted-foreground" />
				<p className="font-medium">Not authorized</p>
				<p className="max-w-xs text-sm text-muted-foreground">
					This area is for Kedaipal admins only.
				</p>
			</div>
		);
	}

	return <AdminSellersContent />;
}

function AdminSellersContent() {
	const sellers = useQuery(convexQuery(api.admin.listSellersForAdmin, {})).data;
	// Dev deployments only (z8r3fdbmc9) — the server re-checks, this just keeps
	// a control that would always refuse off the prod screen entirely.
	const purgeEnabled =
		useQuery(convexQuery(api.admin.devStorePurgeEnabled, {})).data === true;
	const [term, setTerm] = useState("");

	const filtered =
		sellers?.filter((s) => {
			const q = term.trim().toLowerCase();
			if (!q) return true;
			return (
				s.storeName.toLowerCase().includes(q) ||
				s.slug.toLowerCase().includes(q)
			);
		}) ?? [];

	return (
		<div className="flex flex-col gap-6 lg:max-w-4xl">
			<PageHeader
				title="Admin · Sellers"
				subtitle="Open any seller's dashboard to set up or operate their store"
			/>
			<section className="flex flex-col gap-1 lg:hidden">
				<h2 className="text-xl font-bold">Admin · Sellers</h2>
				<p className="text-sm text-muted-foreground">
					Open any seller's dashboard to set up or operate their store.
				</p>
			</section>

			<div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
				<ShieldCheck className="mt-0.5 size-4 shrink-0" />
				<p>
					Opening a store enters <strong>act-as mode</strong>: you operate it as
					the seller and every change you make is logged to your admin account.
				</p>
			</div>

			<Input
				value={term}
				onChange={(e) => setTerm(e.target.value)}
				placeholder="Search by store name or slug"
				className="max-w-sm"
			/>

			{sellers === undefined ? (
				<div className="flex flex-col gap-2">
					<Skeleton className="h-20 w-full rounded-2xl" />
					<Skeleton className="h-20 w-full rounded-2xl" />
					<Skeleton className="h-20 w-full rounded-2xl" />
				</div>
			) : filtered.length === 0 ? (
				<div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border px-6 py-14 text-center">
					<Store className="size-7 text-muted-foreground" />
					<p className="font-medium">
						{sellers.length === 0 ? "No sellers yet" : "No matches"}
					</p>
					<p className="max-w-xs text-sm text-muted-foreground">
						{sellers.length === 0
							? "Sellers appear here once they've completed onboarding."
							: "Try a different store name or slug."}
					</p>
				</div>
			) : (
				<ul className="flex flex-col gap-2">
					{filtered.map((s) => (
						<SellerCard key={s._id} seller={s} purgeEnabled={purgeEnabled} />
					))}
				</ul>
			)}
		</div>
	);
}

const STATUS_STYLES: Record<string, string> = {
	active: "bg-emerald-100 text-emerald-800",
	trialing: "bg-sky-100 text-sky-800",
	past_due: "bg-red-100 text-red-800",
	cancelled: "bg-muted text-muted-foreground",
};

function SellerCard({
	seller,
	purgeEnabled,
}: {
	seller: AdminSellerRow;
	purgeEnabled: boolean;
}) {
	const status = seller.subscriptionStatus;
	const navigate = useNavigate();
	const { setActAs } = useActAs();
	const startActAsSession = useMutation(api.admin.startActAsSession);
	const purgeStore = useMutation(api.admin.purgeStoreForAdmin);
	const [purgeOpen, setPurgeOpen] = useState(false);

	function manage() {
		// Start the act-as session, then open the vendor's dashboard. From here the
		// session holds across all navigation + CRUD until the admin Exits.
		setActAs(seller._id);
		// Audit the tenant ENTRY (read-side attributability). Fire-and-forget — a
		// failed log must never block onboarding.
		void startActAsSession({ retailerId: seller._id }).catch(() => {});
		navigate({ to: "/app" });
	}

	async function confirmPurge() {
		try {
			const result = await purgeStore({
				retailerId: seller._id,
				confirmSlug: seller.slug,
			});
			// The cascade is async — the row vanishes from this list when the
			// retailer doc goes in its final phase, usually within seconds.
			toast.success(
				`Purging ${result.storeName} — the row disappears once the erase finishes, then that login onboards fresh.`,
			);
		} catch (err) {
			toast.error(convexErrorMessage(err));
			// Re-throw so the dialog stays open behind the error toast.
			throw err;
		}
	}

	return (
		// The purge control sits BESIDE the row, not inside it — the whole row is
		// already the "Manage" button, and a button can't nest a button.
		<li className="flex items-stretch gap-2">
			<button
				type="button"
				onClick={manage}
				className="flex min-w-0 flex-1 items-center gap-3 rounded-2xl border border-border bg-card p-4 text-left transition-all hover:border-accent hover:shadow-sm"
			>
				<div className="flex min-w-0 flex-1 flex-col gap-1">
					<div className="flex items-center gap-2">
						<span className="truncate font-semibold">{seller.storeName}</span>
						{seller.foundingMemberRank !== undefined ? (
							<span className="flex shrink-0 items-center gap-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-800">
								<Award className="size-3" />#{seller.foundingMemberRank}
							</span>
						) : null}
					</div>
					<span className="truncate font-mono text-xs text-muted-foreground">
						/{seller.slug}
						{seller.signupSource ? (
							// Acquisition tag the signup arrived with (z8r3fdd1v0) —
							// verbatim, these are Kedaipal's own `?src=` tags. Absent =
							// direct/untagged, so nothing renders for the common case.
							<span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[10px]">
								via {seller.signupSource}
							</span>
						) : null}
					</span>
					<div className="mt-0.5 flex items-center gap-2">
						{seller.ownerIsAdmin ? (
							// Admin-owned store: a single "Admin" pill, not a trial/plan
							// countdown — admins run the app for free with the highest tier
							// unlocked. Matches the dashboard tier-pill's `admin` tone.
							<span className="inline-flex items-center gap-1 rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-semibold text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">
								<ShieldCheck className="size-3" />
								Admin
							</span>
						) : (
							<>
								{status ? (
									<span
										className={`rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize ${
											STATUS_STYLES[status] ?? "bg-muted text-muted-foreground"
										}`}
									>
										{status.replace("_", " ")}
									</span>
								) : (
									<span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
										no subscription
									</span>
								)}
								{seller.plan ? (
									<span className="text-[11px] capitalize text-muted-foreground">
										{seller.plan}
									</span>
								) : null}
							</>
						)}
					</div>
				</div>
				<span className="flex shrink-0 items-center gap-1 rounded-lg bg-accent/10 px-3 py-2 text-sm font-semibold text-accent">
					Manage
					<ChevronRight className="size-4" />
				</span>
			</button>
			{purgeEnabled ? (
				<>
					<button
						type="button"
						onClick={() => setPurgeOpen(true)}
						title="Purge store (dev only)"
						aria-label={`Purge ${seller.storeName} (dev only)`}
						className="flex min-w-11 shrink-0 items-center justify-center rounded-2xl border border-destructive/30 px-3 text-destructive transition-colors hover:border-destructive hover:bg-destructive/10"
					>
						<Trash2 className="size-4" />
					</button>
					<ConfirmDialog
						open={purgeOpen}
						onOpenChange={setPurgeOpen}
						destructive
						title={`Purge ${seller.storeName}?`}
						description={
							<>
								Dev-only test reset. Erases <strong>everything</strong> this
								store owns — products, orders, customers, settings, images —
								and the store itself, exactly like the account-deletion
								cascade. The owner's login survives, so opening /onboarding
								afterwards starts a fresh store. This cannot be undone.
							</>
						}
						confirmPhrase={seller.slug}
						confirmLabel="Purge store"
						onConfirm={confirmPurge}
					/>
				</>
			) : null}
		</li>
	);
}
