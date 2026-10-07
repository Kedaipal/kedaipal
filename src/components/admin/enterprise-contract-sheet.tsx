// The Enterprise contract, opened from Admin · Billing → Issue an invoice
// (ClickUp z8r3fdpm2p). Enterprise bills a negotiated contract, so a store
// without one could not be billed at that tier — and the only door to the
// contract was Admin · Sellers → the store → Manage → Enterprise. Putting a
// store on Enterprise and billing it therefore meant two tabs and picking the
// same store twice. This sheet is that door, where the billing happens.
//
// It is CHROME ONLY: the form, its validation, its refusals and its copy are
// the same `EnterpriseContractForm` the seller sheet renders. Saving is what
// puts the store on Enterprise (`enterprise.setContract` flips the plan), and
// the issue form behind it picks the contract up live — Convex reactivity, no
// refetch, no re-pick.
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
} from "../ui/sheet";
import { Skeleton } from "../ui/skeleton";
import {
	EnterpriseContractForm,
	type EnterpriseContractTemplate,
} from "./enterprise-contract-form";

export function EnterpriseContractSheet({
	retailerId,
	templates,
	open,
	onOpenChange,
}: {
	/** The store being billed. Null closes the sheet — the picker was cleared. */
	retailerId: Id<"retailers"> | null;
	/** Other stores' live contracts, to start a new deal from. The CALLER
	 * excludes this store (same as the sellers directory does) — the list is
	 * built from a store list only the caller has. */
	templates: EnterpriseContractTemplate[];
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	return (
		<Sheet open={open} onOpenChange={onOpenChange}>
			{/* Same drawer as the seller sheet's contract page, down to the
			    width: one form, one presentation. */}
			<SheetContent side="right" className="gap-0 p-0 sm:max-w-lg sm:pb-0">
				{open && retailerId ? (
					<ContractSheetBody
						retailerId={retailerId}
						templates={templates}
						onDone={() => onOpenChange(false)}
					/>
				) : null}
			</SheetContent>
		</Sheet>
	);
}

function ContractSheetBody({
	retailerId,
	templates,
	onDone,
}: {
	retailerId: Id<"retailers">;
	templates: EnterpriseContractTemplate[];
	onDone: () => void;
}) {
	// Mounted only while the sheet is open, so the per-store reads this costs
	// are never paid by an admin who just wanted to bill someone Pro.
	const subject = useQuery(
		convexQuery(api.enterprise.getContractContext, { retailerId }),
	).data;

	return (
		<>
			<SheetHeader className="gap-1 border-b border-border p-5 pr-14">
				{/* The store is named ABOVE the title and never truncated out of
				    existence: this sheet is reached from a dropdown, not from a
				    row the admin is already looking at, so "which store am I
				    writing a contract for?" has to be answerable without
				    closing it. */}
				<span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
					{subject ? subject.storeName : "Loading…"}
				</span>
				<SheetTitle className="font-heading text-xl font-bold">
					{subject?.enterprise
						? "Enterprise contract"
						: "Put on an Enterprise contract"}
				</SheetTitle>
				<SheetDescription>
					What this store is billed and granted, per its deal. Saving puts it on
					Enterprise straight away — then issue the invoice behind this panel.
				</SheetDescription>
			</SheetHeader>

			<div className="p-5">
				{subject === undefined ? (
					<ContractFormSkeleton />
				) : subject === null ? (
					<p className="text-sm text-muted-foreground">
						This store no longer exists — it was removed while this panel was
						open.
					</p>
				) : (
					<EnterpriseContractForm
						subject={subject}
						templates={templates}
						onSaved={onDone}
					/>
				)}
			</div>
		</>
	);
}

/** The form's own shape while the store's facts load — two field groups and a
 * button, so the panel doesn't jump when they arrive. */
function ContractFormSkeleton() {
	return (
		<div className="flex flex-col gap-5" aria-hidden="true">
			{[0, 1].map((group) => (
				<div key={group} className="flex flex-col gap-2">
					<Skeleton className="h-3 w-32" />
					<div className="grid gap-4 sm:grid-cols-2">
						{[0, 1, 2].map((field) => (
							<div key={field} className="flex flex-col gap-1.5">
								<Skeleton className="h-4 w-24" />
								<Skeleton className="h-11 w-full rounded-xl" />
							</div>
						))}
					</div>
				</div>
			))}
			<Skeleton className="h-11 w-full rounded-xl sm:w-40" />
		</div>
	);
}
