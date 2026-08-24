import { APP_VERSION } from "../../lib/app-version";
import { CopyButton } from "../ui/copy-button";
import { cn } from "../../lib/utils";

/**
 * The running app version, shown quietly in the dashboard chrome (86eyqgxna).
 *
 * Placed in the nav surfaces — the More panel on mobile, the sidebar footer on
 * desktop — rather than buried in a Settings tab, because its one job is
 * support: when we ask a seller "what version are you on?", they must be able
 * to find it from whatever screen they are already on, without hunting. It is
 * also where the "What's new" entry will land (86eyqgxv9), so the two form one
 * block answering "what am I running, and what changed?".
 *
 * Copy-able on purpose: the realistic flow is a seller reading this into a
 * WhatsApp message to us, and a mistyped version sends support down the wrong
 * path. Reuses the shared CopyButton so the confirmation + clipboard-unavailable
 * degradation behave exactly as they do everywhere else in the app.
 */
export function AppVersionRow({ className }: { className?: string }) {
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
