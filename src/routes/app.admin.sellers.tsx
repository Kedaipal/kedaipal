import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { Award, ChevronRight, ShieldCheck, ShieldX, Store } from "lucide-react";
import { useState } from "react";
import { api } from "../../convex/_generated/api";
import type { AdminSellerRow } from "../../convex/admin";
import { PageHeader } from "../components/dashboard/page-header";
import { Input } from "../components/ui/input";
import { Skeleton } from "../components/ui/skeleton";

export const Route = createFileRoute("/app/admin/sellers")({
	component: AdminSellersRoute,
});

function AdminSellersRoute() {
	// Client gate is cosmetic — `listSellersForAdmin` is `requireAdmin` server-side.
	const isAdmin = useQuery(api.billing.amIAdmin);

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
	const sellers = useQuery(api.admin.listSellersForAdmin);
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
						<SellerCard key={s._id} seller={s} />
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

function SellerCard({ seller }: { seller: AdminSellerRow }) {
	const status = seller.subscriptionStatus;
	return (
		<li>
			<Link
				to="/app"
				search={{ actAs: seller._id }}
				className="flex items-center gap-3 rounded-2xl border border-border bg-card p-4 text-left transition-all hover:border-accent hover:shadow-sm"
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
					</span>
					<div className="mt-0.5 flex items-center gap-2">
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
					</div>
				</div>
				<span className="flex shrink-0 items-center gap-1 rounded-lg bg-accent/10 px-3 py-2 text-sm font-semibold text-accent">
					Manage
					<ChevronRight className="size-4" />
				</span>
			</Link>
		</li>
	);
}
