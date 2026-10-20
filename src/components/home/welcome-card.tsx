/**
 * The first thing a brand-new store sees (z8r3fdrgzj board "Onboarding 1").
 *
 * Inverted, like the sales hero — it occupies the same slot the revenue card
 * will occupy once orders start, so the page's shape is familiar before there
 * is any money to put in it. The three steps are the ONLY education element
 * kept from the vendor-education discussion; everything else about how
 * Kedaipal works is learned by doing the checklist underneath.
 */
export function WelcomeCard({ slug }: { slug: string }) {
	return (
		<section className="relative flex flex-col gap-4 overflow-hidden rounded-3xl bg-foreground p-5 text-background">
			<div
				aria-hidden="true"
				className="pointer-events-none absolute -right-12 -top-14 size-[200px] rounded-full bg-accent/30 blur-[44px]"
			/>
			<div className="relative flex flex-col gap-1.5">
				<span className="text-[11px] font-bold uppercase tracking-[0.08em] text-accent">
					Welcome to Kedaipal
				</span>
				<h2 className="font-heading text-2xl font-extrabold leading-tight tracking-tight">
					Let's get your store ready
				</h2>
				<p className="text-[13px] leading-relaxed text-background/75">
					Your storefront is live at{" "}
					<span className="font-mono font-semibold text-background">
						kedaipal.com/{slug}
					</span>
					. Finish the steps below and you will be taking WhatsApp orders in
					minutes.
				</p>
			</div>
			<ol className="relative grid grid-cols-3 gap-2 border-t border-background/15 pt-4">
				<Step n={1} text="You share your store link" />
				<Step n={2} text="Shoppers order via WhatsApp" />
				<Step n={3} text="You confirm and update status" />
			</ol>
		</section>
	);
}

function Step({ n, text }: { n: number; text: string }) {
	return (
		<li className="flex flex-col gap-1.5">
			<span className="flex size-6 items-center justify-center rounded-full bg-accent/25 text-[11px] font-bold text-accent">
				{n}
			</span>
			<span className="text-[11px] leading-snug text-background/75">
				{text}
			</span>
		</li>
	);
}
