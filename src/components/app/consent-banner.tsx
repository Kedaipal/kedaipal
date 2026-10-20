import { Link } from "@tanstack/react-router";
import { useMutation } from "convex/react";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import { useStoreRole } from "../../hooks/usePermission";
import { convexErrorMessage } from "../../lib/format";
import { type AcceptedLegalVersions, consentIsStale } from "../../lib/legal";
import { Button } from "../ui/button";

/**
 * Dashboard banner prompting the retailer to re-accept the legal documents
 * after a version bump. Renders nothing while consent is current; the banner
 * disappears reactively once `recordConsentAcceptance` updates the retailer's
 * stored versions.
 */
export function ConsentBanner({
	versions,
}: {
	versions: AcceptedLegalVersions;
}) {
	const recordConsent = useMutation(api.retailers.recordConsentAcceptance);
	const [submitting, setSubmitting] = useState(false);
	// Terms bind the ACCOUNT HOLDER, so ONLY THE OWNER is ever asked.
	//
	// This used to exclude members alone, which left two ways to be shown an ask
	// you must not answer — both found in the 2 Oct hands-on test:
	//
	//  - an ADMIN in act-as sees the banner for the SELLER's stale consent, but
	//    `recordConsentAcceptance` resolves `by_user` on the CALLER, so the
	//    click re-stamps the admin's OWN store and the banner never clears
	//    (verified: IndoMart's termsAcceptedAt moved, the acted-on store's did
	//    not, and the button sat on "Saving…" forever);
	//  - a PRE-BUILT store (docs/prebuilt-stores.md) has no consent stamps by
	//    design — the vendor accepts at the claim — so the banner fires on every
	//    page of every store being built, asking an admin to agree to the terms
	//    on behalf of someone who has not seen them.
	//
	// Owner-only closes both, and closes them the way the server already works
	// rather than by naming each case.
	const role = useStoreRole();

	if (role !== "owner") return null;
	if (!consentIsStale(versions)) return null;

	async function handleAccept() {
		setSubmitting(true);
		try {
			await recordConsent({});
		} catch (err) {
			toast.error(convexErrorMessage(err));
			setSubmitting(false);
		}
	}

	return (
		<div className="flex flex-col gap-3 border-b border-border bg-accent/5 px-5 py-4 sm:flex-row sm:items-center sm:justify-between lg:px-8">
			<p className="text-sm text-foreground/90">
				We've updated our{" "}
				<Link to="/terms" target="_blank" className="font-medium underline">
					Terms
				</Link>
				,{" "}
				<Link to="/privacy" target="_blank" className="font-medium underline">
					Privacy Policy
				</Link>
				, and{" "}
				<Link
					to="/acceptable-use"
					target="_blank"
					className="font-medium underline"
				>
					Acceptable Use Policy
				</Link>
				. Please review and re-accept to continue.
			</p>
			<Button
				type="button"
				onClick={handleAccept}
				disabled={submitting}
				className="shrink-0"
			>
				{submitting ? "Saving…" : "I accept"}
			</Button>
		</div>
	);
}
