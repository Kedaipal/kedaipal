import { CopyButton } from "kedaipal";

export function Default() {
	return (
		<div className="flex items-center gap-2 rounded-lg border px-3 py-1">
			<span className="font-mono text-sm">ORD-1042</span>
			<CopyButton value="ORD-1042" ariaLabel="Copy order ID" />
		</div>
	);
}

export function IconOnlyLabel() {
	return (
		<div className="flex items-center gap-2 rounded-lg border px-3 py-1">
			<span className="font-mono text-sm">8123456789012</span>
			<CopyButton
				value="8123456789012"
				ariaLabel="Copy account number"
				labelClassName="hidden lg:inline"
			/>
		</div>
	);
}
