/**
 * The reason beside a billing action an admin can't take while acting-as a
 * seller (z8r3fdfty4). Subscribing, auto-renewal and plan changes resolve the
 * CALLER's store server-side, so inside act-as they used to act on the admin's
 * OWN store; and paying or saving a card is the owner's consent to give, not
 * ours. So the action stays visible (the admin sees exactly what the seller
 * sees) but disabled, with this line where they're clicking.
 */
export function OwnerOnlyNote() {
	return (
		<p className="text-xs text-muted-foreground">
			Only the store owner can do this: payments are authorised with their own
			card or Touch 'n Go, so you can't do it while viewing as admin.
		</p>
	);
}
