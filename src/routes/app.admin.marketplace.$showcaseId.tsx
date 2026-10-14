import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { ShieldX } from "lucide-react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { ShowcaseEditor } from "../components/admin/showcase-editor";
import { Skeleton } from "../components/ui/skeleton";

/** Admin · one showcase's editor (z8r3fdr6mv). */
export const Route = createFileRoute("/app/admin/marketplace/$showcaseId")({
	component: AdminShowcaseRoute,
});

function AdminShowcaseRoute() {
	const { showcaseId } = Route.useParams();
	const isAdmin = useQuery(convexQuery(api.billing.amIAdmin, {})).data;
	if (isAdmin === undefined) {
		return (
			<div className="flex flex-col gap-4 lg:max-w-4xl">
				<Skeleton className="h-7 w-48" />
				<Skeleton className="h-40 w-full rounded-2xl" />
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
	return (
		<ShowcaseEditor showcaseId={showcaseId as Id<"marketplaceShowcases">} />
	);
}
