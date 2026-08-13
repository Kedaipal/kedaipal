import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "kedaipal";

export function Open() {
	return (
		<DropdownMenu open>
			<DropdownMenuTrigger asChild>
				<button type="button" className="rounded-lg border px-3 py-1.5 text-sm">
					New order
				</button>
			</DropdownMenuTrigger>
			<DropdownMenuContent>
				<DropdownMenuLabel>Start a sale</DropdownMenuLabel>
				<DropdownMenuItem>Show store QR</DropdownMenuItem>
				<DropdownMenuItem>Enter phone number</DropdownMenuItem>
				<DropdownMenuSeparator />
				<DropdownMenuItem>Cash sale</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
