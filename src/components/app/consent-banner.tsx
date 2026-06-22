import { Link } from "@tanstack/react-router";
import { useMutation } from "convex/react";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
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
