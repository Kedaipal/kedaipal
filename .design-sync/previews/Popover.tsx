import {
	Popover,
	PopoverContent,
	PopoverDescription,
	PopoverHeader,
	PopoverTitle,
	PopoverTrigger,
} from "kedaipal";

// Radix Popover only paints its content while open, and the closed default
// isn't a useful screenshot — force it open so the card shows real content.
export function Open() {
	return (
		<Popover open>
			<PopoverTrigger asChild>
				<button type="button" className="rounded-lg border px-3 py-1.5 text-sm">
					Delivery fee
				</button>
			</PopoverTrigger>
			<PopoverContent>
				<PopoverHeader>
					<PopoverTitle>How this is calculated</PopoverTitle>
					<PopoverDescription>
						Priced from the buyer's address using your radius bands.
					</PopoverDescription>
				</PopoverHeader>
			</PopoverContent>
		</Popover>
	);
}
