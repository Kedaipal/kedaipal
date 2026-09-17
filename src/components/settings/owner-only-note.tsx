/**
 * The reason beside a billing action an admin can't take while acting as a
 * seller (z8r3fdfty4). Billing is VIEW-ONLY under act-as (Zaki, 17 Sep 2026):
 * it is the seller's money and consent, and every legitimate admin billing
 * action (issue, void, mark paid, comp) already lives in Admin → Billing. So
 * each action stays visible — the admin sees exactly what the seller sees —
 * but disabled, with this line where they're clicking. The tab's top banner
 * carries the longer explanation.
 */
export function OwnerOnlyNote() {
	return (
		<p className="text-xs text-muted-foreground">
			View-only while you're acting as this store — billing changes are the
			owner's to make.
		</p>
	);
}
