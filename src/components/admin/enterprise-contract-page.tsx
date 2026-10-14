// The Enterprise contract as a PAGE of the seller sheet (Credits T6, ClickUp
// z8r3fdkp8h) — one drawer, a back link to the seller, like the credit ledger.
// The form itself is shared with the billing card's sheet
// (`EnterpriseContractForm`, z8r3fdpm2p); all this file owns is the chrome and
// the way back.
import { ChevronLeft } from "lucide-react";
import { useEffect, useRef } from "react";
import type { AdminSellerRow } from "../../../convex/admin";
import { SheetDescription, SheetHeader, SheetTitle } from "../ui/sheet";
import {
	EnterpriseContractForm,
	type EnterpriseContractTemplate,
} from "./enterprise-contract-form";

export type { EnterpriseContractTemplate };

export function EnterpriseContractPage({
	seller,
	templates,
	onBack,
}: {
	seller: AdminSellerRow;
	/** Other stores' contracts, to start a new deal from. Comes from the
	 * sellers list the drawer was opened out of — no extra query. */
	templates: EnterpriseContractTemplate[];
	onBack: () => void;
}) {
	const backRef = useRef<HTMLButtonElement>(null);
	useEffect(() => {
		const back = backRef.current;
		const drawer = back?.closest<HTMLElement>('[data-slot="sheet-content"]');
		if (drawer) drawer.scrollTop = 0;
		back?.focus();
	}, []);

	return (
		<>
			<SheetHeader className="gap-1 border-b border-border p-5 pr-14">
				<button
					ref={backRef}
					type="button"
					onClick={onBack}
					className="-ml-2 mb-1 inline-flex min-h-11 w-fit max-w-full items-center gap-1 rounded-lg px-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground sm:min-h-9"
				>
					<ChevronLeft className="size-4 shrink-0" aria-hidden="true" />
					<span className="truncate">{seller.storeName}</span>
				</button>
				<SheetTitle className="font-heading text-xl font-bold">
					{seller.enterprise
						? "Enterprise contract"
						: "Put on an Enterprise contract"}
				</SheetTitle>
				<SheetDescription>
					What this store is billed and granted, per its deal. Saved to the
					store and logged to your admin account.
				</SheetDescription>
			</SheetHeader>

			<div className="p-5">
				{/* `AdminSellerRow` satisfies `EnterpriseContractSubject`
				    structurally — the directory already carries every fact the
				    form reads, so there is nothing to map. */}
				<EnterpriseContractForm
					subject={seller}
					templates={templates}
					onSaved={onBack}
				/>
			</div>
		</>
	);
}
