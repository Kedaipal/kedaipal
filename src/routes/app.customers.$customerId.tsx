import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { ChevronLeft, Users } from "lucide-react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { ProFeatureWall } from "../components/app/pro-gate";
import { CustomerDetail } from "../components/dashboard/customer-detail";
import {
	PageHeader,
	PageHeaderSkeleton,
} from "../components/dashboard/page-header";
import { Skeleton } from "../components/ui/skeleton";
import { useDashboardRetailer } from "../hooks/useDashboardRetailer";
import { getDisplayName } from "../lib/customer";
import { hasFeature } from "../lib/subscription";

export const Route = createFileRoute("/app/customers/$customerId")({
	component: CustomerDetailRoute,
});

function CustomerDetailRoute() {
	const { customerId } = Route.useParams();
	const id = customerId as Id<"customers">;
	const retailer = useDashboardRetailer();
	// Plan gate (Pro+) — mirrors the list route; queries skipped while locked so
	// the server gate (assertPlanFeature) is never tripped in normal use.
	const crmLocked =
		!!retailer &&
		!retailer.actingAsAdmin &&
		!hasFeature(retailer.subscription, "crm");
	// Held while the retailer payload is loading too — the plan isn't known yet,
	// and firing the query for a Starter seller would hit the server gate.
	const customer = useQuery(
		api.customers.get,
		!retailer || crmLocked ? "skip" : { customerId: id },
	);
	const orders = useQuery(
		api.customers.ordersByCustomer,
		!retailer || crmLocked
			? "skip"
			: { customerId: id, paginationOpts: { numItems: 50, cursor: null } },
	);

	if (crmLocked && retailer) {
		return (
			<div className="flex flex-col gap-5 lg:gap-6">
				<PageHeader title="Customers" subtitle="Available on Pro" />
				<ProFeatureWall
					slug={retailer.slug}
					icon={<Users className="size-5 text-muted-foreground" />}
					title="Customer profiles are a Pro feature"
					blurb="Upgrade to see this customer's order history, lifetime value and your private notes."
				/>
			</div>
		);
	}

	if (customer === undefined) {
		return <CustomerDetailSkeleton />;
	}
	if (customer === null) {
		return (
			<div className="flex flex-col gap-4">
				<Link
					to="/app/customers"
					className="flex w-fit items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
				>
					<ChevronLeft className="size-4" />
					Customers
				</Link>
				<p className="text-sm text-destructive">Customer not found.</p>
			</div>
		);
	}

	const displayName = getDisplayName(customer);
	const currency = retailer?.currency ?? "MYR";

	return (
		<div className="flex flex-col gap-5 lg:gap-6">
			<PageHeader
				title={displayName}
				subtitle={`${customer.orderCount} order${
					customer.orderCount === 1 ? "" : "s"
				}`}
				back={{ to: "/app/customers", label: "Customers" }}
			/>
			{/* Back nav + title (mobile) */}
			<Link
				to="/app/customers"
				className="flex w-fit items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground lg:hidden"
			>
				<ChevronLeft className="size-4" />
				Customers
			</Link>
			<h2 className="text-2xl font-bold tracking-tight lg:hidden">
				{displayName}
			</h2>

			<CustomerDetail
				customer={customer}
				currency={currency}
				orders={orders?.page ?? []}
				ordersLoading={orders === undefined}
			/>
		</div>
	);
}

function CustomerDetailSkeleton() {
	return (
		<div className="flex flex-col gap-5 lg:gap-6">
			<PageHeaderSkeleton hasBack hasSubtitle />
			<Skeleton className="h-4 w-20 rounded lg:hidden" />
			<Skeleton className="h-7 w-40 rounded lg:hidden" />
			{/* Contact card */}
			<div className="flex items-center gap-3 rounded-2xl border border-border bg-card p-4">
				<Skeleton className="size-12 shrink-0 rounded-full" />
				<div className="flex flex-1 flex-col gap-1.5">
					<Skeleton className="h-5 w-32 rounded" />
					<Skeleton className="h-3 w-28 rounded" />
				</div>
				<Skeleton className="size-10 shrink-0 rounded-full" />
			</div>
			{/* Metrics */}
			<div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
				{[0, 1, 2, 3].map((n) => (
					<Skeleton key={n} className="h-16 rounded-2xl" />
				))}
			</div>
			{/* Notes */}
			<Skeleton className="h-24 rounded-2xl" />
		</div>
	);
}
