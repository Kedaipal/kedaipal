import { ConfirmDialog } from "kedaipal";

export function Default() {
	return (
		<ConfirmDialog
			open
			onOpenChange={() => {}}
			title="Cancel this order?"
			description="The buyer will be notified on WhatsApp. This can't be undone."
			confirmLabel="Cancel order"
			destructive
			onConfirm={() => {}}
		/>
	);
}

export function TypeToConfirm() {
	return (
		<ConfirmDialog
			open
			onOpenChange={() => {}}
			title="Permanently delete this order?"
			description="This erases the order and everything derived from it. This cannot be undone."
			confirmLabel="Delete permanently"
			confirmPhrase="DELETE"
			destructive
			onConfirm={() => {}}
		/>
	);
}
