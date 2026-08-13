import {
	Button,
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "kedaipal";

// Rendered permanently open (`open` fixed true, no trigger/close wiring) so
// the card shows the real modal chrome instead of a closed no-op.
export function Open() {
	return (
		<Dialog open>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Cancel this order?</DialogTitle>
					<DialogDescription>
						The buyer will be notified on WhatsApp. This can't be undone.
					</DialogDescription>
				</DialogHeader>
				<DialogFooter>
					<Button variant="outline">Keep order</Button>
					<Button variant="destructive">Cancel order</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
