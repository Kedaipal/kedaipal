import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { cn } from "../../lib/utils";

interface CopyButtonProps {
	/** Text written to the clipboard on tap. */
	value: string;
	/** Accessible label (the visible text stays "Copy"/"Copied"). */
	ariaLabel?: string;
	/** Toast shown on a successful copy. */
	successMessage?: string;
	className?: string;
}

/**
 * One-tap copy button with a brief check-mark confirmation + toast. Degrades
 * gracefully when the Clipboard API is unavailable (insecure context / denied
 * permission) — it tells the user to copy manually rather than failing silently.
 */
export function CopyButton({
	value,
	ariaLabel = "Copy",
	successMessage = "Copied",
	className,
}: CopyButtonProps) {
	const [copied, setCopied] = useState(false);

	async function handleCopy() {
		if (!navigator.clipboard) {
			toast.error("Couldn't copy — please copy manually");
			return;
		}
		try {
			await navigator.clipboard.writeText(value);
			setCopied(true);
			toast.success(successMessage);
			setTimeout(() => setCopied(false), 1500);
		} catch {
			toast.error("Couldn't copy — please copy manually");
		}
	}

	return (
		<button
			type="button"
			onClick={handleCopy}
			aria-label={ariaLabel}
			className={cn(
				"flex h-9 shrink-0 items-center gap-1 rounded-full px-3 text-xs font-medium transition-colors",
				copied
					? "text-emerald-600"
					: "text-muted-foreground hover:bg-muted hover:text-foreground",
				className,
			)}
		>
			{copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
			{copied ? "Copied" : "Copy"}
		</button>
	);
}
