import { Search, X } from "lucide-react";
import {
	InputGroup,
	InputGroupAddon,
	InputGroupButton,
	InputGroupInput,
} from "kedaipal";

export function Search_() {
	return (
		<InputGroup className="w-72">
			<InputGroupAddon>
				<Search className="size-4" />
			</InputGroupAddon>
			<InputGroupInput placeholder="Search orders…" defaultValue="ORD-1042" />
			<InputGroupAddon align="inline-end">
				<InputGroupButton size="icon-xs" aria-label="Clear">
					<X className="size-3.5" />
				</InputGroupButton>
			</InputGroupAddon>
		</InputGroup>
	);
}
