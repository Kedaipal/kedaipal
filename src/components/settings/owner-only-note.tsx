import { useStoreRole } from "../../hooks/usePermission";

/**
 * The reason beside a billing action the person looking at it can't take.
 *
 * TWO viewers reach the Billing tab without the right to change anything, and
 * they need different sentences:
 *
 * - an ADMIN acting as a seller (z8r3fdfty4). Billing is VIEW-ONLY under act-as
 *   (Zaki, 17 Sep 2026): it is the seller's money and consent, and every
 *   legitimate admin billing action (issue, void, mark paid, comp) already
 *   lives in Admin → Billing.
 * - a TEAMMATE granted billing READ (86exr91r4). Billing WRITE is owner-only by
 *   construction, so the controls are equally out of reach — but "while you're
 *   acting as this store" would be a sentence about somebody else's situation.
 *
 * Either way each action stays visible and disabled, with this line where
 * they're clicking, and the tab's top banner carries the longer explanation.
 * The role is read here rather than passed, so all ten call sites stay one
 * line and none of them can pick the wrong reason.
 */
export function OwnerOnlyNote() {
	const isMember = useStoreRole() === "member";
	return (
		<p className="text-xs text-muted-foreground">
			{isMember
				? "Only the store owner can change billing — ask them if something here needs updating."
				: "View-only while you're acting as this store — billing changes are the owner's to make."}
		</p>
	);
}
