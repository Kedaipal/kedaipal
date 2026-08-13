import {
	Button,
	Sheet,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
} from "kedaipal";

export function Open() {
	return (
		<Sheet open>
			<SheetContent>
				<SheetHeader>
					<SheetTitle>Custom date range</SheetTitle>
					<SheetDescription>Pick a start and end date for this report.</SheetDescription>
				</SheetHeader>
				<div className="flex justify-end gap-2 pt-2">
					<Button variant="outline">Cancel</Button>
					<Button>Apply</Button>
				</div>
			</SheetContent>
		</Sheet>
	);
}
