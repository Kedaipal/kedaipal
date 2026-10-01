import { useClerk } from "@clerk/tanstack-react-start";
import { LogOut, MessageCircle, RefreshCw, TriangleAlert } from "lucide-react";
import { useSupportWaNumber } from "../../hooks/useSupportWaNumber";
import { buildWaContactLink } from "../../lib/contact";
import { reloadPage } from "../../lib/reload";
import { Button } from "../ui/button";
import { FullPageError } from "../ui/full-page-error";

/**
 * What `/app` shows when the read every dashboard page waits on — the store
 * being operated — FAILS. It used to be the loading skeleton, forever: an
 * adapter read that throws settles as "no data", which looks exactly like a
 * slow one (ClickUp z8r3fdkqn6). Now the reader is told in a sentence and
 * handed every way out:
 *
 * - a seller: Reload (a stale tab or a client from before a deploy), Sign out
 *   (an account that can't reach its store), and our WhatsApp if neither works;
 * - an admin acting as a store: Exit act-as first — it is the acted-as store
 *   that didn't load, and exiting lands them back on the seller directory —
 *   then Reload.
 */
export function DashboardLoadError({
	error,
	actingAs,
	onExitActAs,
}: {
	error: Error;
	actingAs: boolean;
	onExitActAs: () => void;
}) {
	const { signOut } = useClerk();
	const supportWa = useSupportWaNumber();
	const reload = (
		<Button
			type="button"
			variant={actingAs ? "outline" : "default"}
			className="h-11 rounded-xl px-6"
			onClick={reloadPage}
		>
			<RefreshCw className="size-4" aria-hidden />
			Reload
		</Button>
	);

	if (actingAs) {
		return (
			<FullPageError
				icon={TriangleAlert}
				title="Couldn't open this store"
				actions={
					<>
						<Button
							type="button"
							className="h-11 rounded-xl px-6"
							onClick={onExitActAs}
						>
							<LogOut className="size-4" aria-hidden />
							Exit act-as
						</Button>
						{reload}
					</>
				}
				detail={error.message}
			>
				The store you're acting as didn't load. Exit to the seller directory,
				or reload to try again.
			</FullPageError>
		);
	}

	return (
		<FullPageError
			icon={TriangleAlert}
			title="Your dashboard didn't load"
			actions={
				<>
					{reload}
					<Button
						type="button"
						variant="outline"
						className="h-11 rounded-xl px-6"
						onClick={() => void signOut({ redirectUrl: "/" })}
					>
						<LogOut className="size-4" aria-hidden />
						Sign out
					</Button>
				</>
			}
			footer={
				<a
					href={buildWaContactLink(
						"Hi Kedaipal! My dashboard won't load — it says it couldn't load my store. Could you take a look?",
						supportWa,
					)}
					target="_blank"
					rel="noopener noreferrer"
					className="inline-flex min-h-11 items-center gap-1.5 px-2 text-sm font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
				>
					<MessageCircle className="size-4" aria-hidden />
					Still stuck? Message us on WhatsApp
				</a>
			}
			detail={error.message}
		>
			Kedaipal couldn't load your store just now. Reloading usually fixes it —
			if it doesn't, sign out and back in.
		</FullPageError>
	);
}
