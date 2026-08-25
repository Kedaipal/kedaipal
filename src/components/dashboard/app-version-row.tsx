import { Check } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { APP_VERSION } from "../../lib/app-version";
import { cn } from "../../lib/utils";
import { CopyButton } from "../ui/copy-button";

/**
 * The running app version, shown quietly in the dashboard chrome (86eyqgxna).
 *
 * Placed in the nav surfaces — the More panel on mobile, the sidebar footer on
 * desktop — rather than buried in a Settings tab, because its one job is
 * support: when we ask a seller "what version are you on?", they must be able
 * to find it from whatever screen they are already on, without hunting. It sits
 * beside "What's new" (86eyqgxv9), so the two together answer "what am I
 * running, and what changed?".
 *
 * Copy-able on purpose: the realistic flow is a seller reading this into a
 * WhatsApp message to us, and a mistyped version sends support down the wrong
 * path.
 */
export function AppVersionRow({
	className,
	compact = false,
}: {
	className?: string;
	/**
	 * `true` renders just the number as a copy-on-tap pill, for the sidebar's
	 * single meta line where "What's new" already owns the left-hand side.
	 * `false` (default) is the full labelled row used in the mobile More panel,
	 * where each item is its own list row.
	 */
	compact?: boolean;
}) {
	if (compact) return <VersionPill className={className} />;

	return (
		<div
			className={cn(
				"flex items-center justify-between gap-2 px-3 text-xs text-muted-foreground",
				className,
			)}
		>
			<span>
				Version{" "}
				{/* tabular-nums keeps the digits from shifting width between
				    releases — the row sits in fixed chrome on every screen. */}
				<span className="font-medium tabular-nums text-foreground/80">
					{APP_VERSION}
				</span>
			</span>
			<CopyButton
				value={APP_VERSION}
				ariaLabel={`Copy app version ${APP_VERSION}`}
				successMessage="Version copied"
				labelClassName="sr-only"
				className="-mr-1"
			/>
		</div>
	);
}

/**
 * The compact pill. Hand-rolled rather than `CopyButton` because that primitive
 * is a 44px-tall labelled control — correct for a touch list row, far too tall
 * for the sidebar's meta line. This lives only in the desktop sidebar (`lg` and
 * up, pointer input), where the design system explicitly allows compact
 * mouse-only controls; the mobile More panel keeps the full-size row above.
 *
 * The pill IS the copy affordance — no separate icon button — so one small
 * target does one thing.
 */
function VersionPill({ className }: { className?: string }) {
	const [copied, setCopied] = useState(false);

	async function handleCopy() {
		if (!navigator.clipboard) {
			toast.error("Couldn't copy — please copy manually");
			return;
		}
		try {
			await navigator.clipboard.writeText(APP_VERSION);
			setCopied(true);
			toast.success("Version copied");
			setTimeout(() => setCopied(false), 1500);
		} catch {
			toast.error("Couldn't copy — please copy manually");
		}
	}

	return (
		<button
			type="button"
			onClick={handleCopy}
			aria-label={`App version ${APP_VERSION} — copy`}
			title={`Version ${APP_VERSION} — click to copy`}
			className={cn(
				"flex shrink-0 items-center gap-1 rounded-full bg-muted px-2 py-1 text-[11px] tabular-nums transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
				copied
					? "text-accent-emphasis"
					: "text-muted-foreground hover:text-foreground",
				className,
			)}
		>
			{copied ? <Check className="size-3" strokeWidth={2.5} /> : null}
			{APP_VERSION}
		</button>
	);
}
