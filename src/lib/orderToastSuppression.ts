// Lets an action that's about to auto-confirm an order (e.g. marking
// payment received on a pending order) silence the next generic
// "Order confirmed" toast from useOrderToastNotifications, so the seller
// sees one specific toast instead of two for the same event.
let suppressUntil = 0;

export function suppressNextOrderConfirmedToast(): void {
	suppressUntil = Date.now() + 5000;
}

export function consumeOrderConfirmedToastSuppression(): boolean {
	if (Date.now() >= suppressUntil) return false;
	suppressUntil = 0;
	return true;
}
