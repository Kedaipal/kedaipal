import {
	Button,
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "kedaipal";

// DialogFooter only renders meaningfully inside its parent Dialog — this is
// the same composition as the Dialog preview, since that's the only render
// of this piece that's actually true.
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
