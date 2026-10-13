import { Wallet } from "lucide-react";

/**
 * Where the money WILL appear (z8r3fdrgzj board "Onboarding 2").
 *
 * Deliberately not hidden until the first order. A seller who has finished
 * setup is waiting for something to happen, and showing the empty frame tells
 * them where to look when it does — hiding it would mean the page silently
 * grows a new section one day, which reads as the app changing rather than
 * their store starting.
 */
export function EmptySalesCard() {
	return (
		<section className="flex flex-col gap-2.5 rounded-3xl border-2 border-dashed border-border bg-card p-5">
			<span className="flex items-center gap-2">
				<span className="flex size-[26px] shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
					<Wallet className="size-3.5" aria-hidden="true" />
				</span>
				<span className="text-[11px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
					Revenue earned
				</span>
			</span>
			<p className="font-heading text-xl font-extrabold tracking-tight">
				Your first order will show up here
			</p>
			<p className="text-[13px] leading-relaxed text-muted-foreground">
				Once orders come in, this page tells you how much you earned, how much
				is collected, what sells best and who comes back.
			</p>
		</section>
	);
}
