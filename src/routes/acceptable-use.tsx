import { createFileRoute, Link } from "@tanstack/react-router";
import { LegalLayout } from "../components/legal/legal-layout";
import { AUP_VERSION, LEGAL_CONTACT_EMAIL } from "../lib/legal";

const SEO_TITLE = "Acceptable Use Policy — Kedaipal";
const SEO_DESC =
	"The rules every Kedaipal retailer agrees to follow to keep our shared WhatsApp number trusted: no spam, respect opt-outs, no illegal goods.";
const SITE_URL = "https://kedaipal.com";
const PAGE_URL = `${SITE_URL}/acceptable-use`;
const OG_IMAGE = `${SITE_URL}/og-image.png`;

const contactLink = (
	<a
		href={`mailto:${LEGAL_CONTACT_EMAIL}`}
		className="underline hover:text-foreground"
	>
		{LEGAL_CONTACT_EMAIL}
	</a>
);

export const Route = createFileRoute("/acceptable-use")({
	head: () => ({
		meta: [
			{ title: SEO_TITLE },
			{ name: "description", content: SEO_DESC },
			{ property: "og:type", content: "website" },
			{ property: "og:url", content: PAGE_URL },
			{ property: "og:title", content: SEO_TITLE },
			{ property: "og:description", content: SEO_DESC },
			{ property: "og:image", content: OG_IMAGE },
			{ name: "twitter:card", content: "summary_large_image" },
			{ name: "twitter:title", content: SEO_TITLE },
			{ name: "twitter:description", content: SEO_DESC },
			{ name: "twitter:image", content: OG_IMAGE },
		],
		links: [{ rel: "canonical", href: PAGE_URL }],
	}),
	component: AcceptableUsePage,
});

function AcceptableUsePage() {
	return (
		<LegalLayout
			title="Acceptable Use Policy"
			lastUpdated={AUP_VERSION}
			summary={[
				"Kedaipal is a tool for legitimate small businesses to manage WhatsApp orders.",
				"To keep our shared WhatsApp number trusted by Meta, every retailer follows common-sense rules: don't spam, respect when customers say “STOP”, don't sell illegal goods, and don't try to game the system.",
				"If you break these rules, we may pause or close your account.",
				<>Questions? Contact us at {contactLink}.</>,
			]}
		>
			<section className="space-y-3">
				<h2 className="text-2xl font-semibold tracking-tight">
					1. Who this applies to
				</h2>
				<p>
					This Acceptable Use Policy ("AUP") applies to every retailer ("you",
					"your") with an active Kedaipal account, and to anyone using your
					storefront, dashboard, or WhatsApp messages sent through Kedaipal's
					infrastructure.
				</p>
				<p>
					By signing up for Kedaipal, you agree to follow this AUP. We may
					update it with 30 days' notice; continued use after the effective date
					of any update means you accept the changes.
				</p>
			</section>

			<section className="space-y-3">
				<h2 className="text-2xl font-semibold tracking-tight">
					2. Why this policy exists (and why it matters to you)
				</h2>
				<p>
					Kedaipal sends messages to your customers through a shared WhatsApp
					Business Account (WABA) that we own and manage. This means:
				</p>
				<ul className="list-disc space-y-2 pl-6">
					<li>
						You don't have to set up your own WhatsApp Business API account, get
						Meta-verified, or wait weeks for approval. Just sign up and go.
					</li>
					<li>
						<strong>But it also means</strong> that if one retailer abuses
						WhatsApp policies, Meta can degrade or suspend the entire Kedaipal
						WABA — affecting every retailer on the platform.
					</li>
				</ul>
				<p>
					This AUP exists to protect you (and every other retailer) from the
					consequences of any one bad actor. We enforce it firmly because we
					have to.
				</p>
			</section>

			<section className="space-y-3">
				<h2 className="text-2xl font-semibold tracking-tight">
					3. Prohibited content and conduct
				</h2>
				<p>
					You may not use Kedaipal to send, store, distribute, or facilitate:
				</p>

				<h3 className="text-lg font-semibold">3.1 Illegal goods or services</h3>
				<ul className="list-disc space-y-2 pl-6">
					<li>
						Anything illegal under Malaysian law, including but not limited to:
						unlicensed prescription medication, controlled substances,
						counterfeit goods, stolen property, illegal gambling, unlicensed
						financial services, or anything requiring a license you don't hold.
					</li>
				</ul>

				<h3 className="text-lg font-semibold">3.2 Adult or harmful content</h3>
				<ul className="list-disc space-y-2 pl-6">
					<li>
						Sexually explicit content, content involving minors, hate speech,
						harassment, threats of violence, or content that promotes self-harm.
					</li>
				</ul>

				<h3 className="text-lg font-semibold">3.3 Deceptive practices</h3>
				<ul className="list-disc space-y-2 pl-6">
					<li>
						Scams, phishing, pyramid schemes, multi-level marketing operations
						not registered under the Direct Sales and Anti-Pyramid Scheme Act
						1993, "get rich quick" schemes, fake reviews, false advertising, or
						any deceptive offer.
					</li>
				</ul>

				<h3 className="text-lg font-semibold">
					3.4 Spam and unsolicited messaging
				</h3>
				<ul className="list-disc space-y-2 pl-6">
					<li>
						Sending WhatsApp messages to people who haven't given you their
						phone number for the purpose of receiving messages from your
						business.
					</li>
					<li>
						Buying, scraping, or otherwise acquiring contact lists you didn't
						legitimately collect.
					</li>
					<li>Broadcasting to customers who have opted out (see Section 4).</li>
					<li>
						Sending the same or substantially similar message to more than 50
						phone numbers within a 5-minute window if you are not on the Scale
						tier, or in any pattern that triggers customer spam reports.
					</li>
				</ul>

				<h3 className="text-lg font-semibold">
					3.5 WhatsApp policy violations
				</h3>
				<ul className="list-disc space-y-2 pl-6">
					<li>
						Anything that violates Meta's{" "}
						<a
							href="https://business.whatsapp.com/policy"
							target="_blank"
							rel="noopener noreferrer"
							className="underline hover:text-foreground"
						>
							WhatsApp Business Messaging Policy
						</a>{" "}
						or{" "}
						<a
							href="https://www.whatsapp.com/legal/commerce-policy"
							target="_blank"
							rel="noopener noreferrer"
							className="underline hover:text-foreground"
						>
							Commerce Policy
						</a>
						.
					</li>
					<li>
						Using Kedaipal to circumvent Meta's restrictions on your own
						WhatsApp account.
					</li>
				</ul>

				<h3 className="text-lg font-semibold">3.6 Platform abuse</h3>
				<ul className="list-disc space-y-2 pl-6">
					<li>
						Attempting to bypass usage limits (order caps, broadcast quotas)
						through multiple accounts.
					</li>
					<li>
						Reverse-engineering, scraping, or interfering with Kedaipal's
						systems.
					</li>
					<li>Using stolen payment methods to subscribe to Kedaipal.</li>
					<li>Creating accounts on behalf of others without their consent.</li>
				</ul>

				<h3 className="text-lg font-semibold">3.7 Privacy violations</h3>
				<ul className="list-disc space-y-2 pl-6">
					<li>
						Sharing your customers' personal data with third parties without
						their consent.
					</li>
					<li>
						Using Kedaipal to collect data from minors without parental consent
						(Kedaipal is not intended for use by anyone under 18).
					</li>
					<li>
						Failing to respond to customer data requests as required under the
						Personal Data Protection Act 2010 (PDPA).
					</li>
				</ul>
			</section>

			<section className="space-y-3">
				<h2 className="text-2xl font-semibold tracking-tight">
					4. Opt-out requirements (mandatory)
				</h2>
				<p>
					WhatsApp customers must be able to opt out of receiving messages from
					you at any time. Kedaipal enforces this automatically:
				</p>
				<ul className="list-disc space-y-2 pl-6">
					<li>
						Any inbound message from a customer containing <code>STOP</code>,{" "}
						<code>BERHENTI</code>, or <code>UNSUB</code> (case-insensitive)
						registers them as opted out.
					</li>
					<li>
						Opt-outs are <strong>global across the Kedaipal platform</strong> —
						a customer who opts out from any retailer using Kedaipal's shared
						WhatsApp number will not receive broadcast messages from any other
						retailer using the same number. This is required to keep our WABA in
						good standing with Meta.
					</li>
					<li>
						You may not message a customer who has opted out, regardless of your
						prior relationship with them.
					</li>
					<li>
						Opt-outs can only be reversed by the customer sending{" "}
						<code>START</code> or <code>MULA</code>.
					</li>
				</ul>
				<p>
					Attempting to bypass or game the opt-out system is grounds for
					immediate suspension.
				</p>
			</section>

			<section className="space-y-3">
				<h2 className="text-2xl font-semibold tracking-tight">
					5. Quality thresholds
				</h2>
				<p>
					Kedaipal monitors the quality of outbound messages from your account.
					If your metrics fall outside the following ranges, your account may be
					auto-paused for review:
				</p>
				<div className="overflow-x-auto">
					<table className="w-full border-collapse text-sm">
						<thead>
							<tr className="border-b border-border text-left">
								<th className="py-2 pr-4 font-semibold">Metric</th>
								<th className="py-2 pr-4 font-semibold">Acceptable</th>
								<th className="py-2 pr-4 font-semibold">Trigger review</th>
								<th className="py-2 font-semibold">Trigger suspension</th>
							</tr>
						</thead>
						<tbody>
							<tr className="border-b border-border/60">
								<td className="py-2 pr-4">
									Customer opt-out rate (broadcasts)
								</td>
								<td className="py-2 pr-4">&lt; 5%</td>
								<td className="py-2 pr-4">5–10%</td>
								<td className="py-2">&gt; 10%</td>
							</tr>
							<tr className="border-b border-border/60">
								<td className="py-2 pr-4">
									Customer block rate (any messaging)
								</td>
								<td className="py-2 pr-4">&lt; 2%</td>
								<td className="py-2 pr-4">2–5%</td>
								<td className="py-2">&gt; 5%</td>
							</tr>
							<tr className="border-b border-border/60">
								<td className="py-2 pr-4">
									Customer complaint rate (Meta-reported)
								</td>
								<td className="py-2 pr-4">0</td>
								<td className="py-2 pr-4">1–2 / month</td>
								<td className="py-2">3+ / month</td>
							</tr>
							<tr>
								<td className="py-2 pr-4">Bounce rate (invalid numbers)</td>
								<td className="py-2 pr-4">&lt; 10%</td>
								<td className="py-2 pr-4">10–25%</td>
								<td className="py-2">&gt; 25%</td>
							</tr>
						</tbody>
					</table>
				</div>
				<p>
					These thresholds exist to protect every retailer's deliverability.
					They are not negotiable.
				</p>
			</section>

			<section className="space-y-3">
				<h2 className="text-2xl font-semibold tracking-tight">
					6. Enforcement
				</h2>
				<p>When we identify a violation of this AUP, we follow this process:</p>

				<h3 className="text-lg font-semibold">6.1 Warning</h3>
				<p>
					For minor or first-time violations, we'll send you a warning by email
					and (where applicable) pause the specific behavior (e.g., temporarily
					disable broadcasts). You'll have 7 days to respond and/or adjust.
				</p>

				<h3 className="text-lg font-semibold">6.2 Temporary suspension</h3>
				<p>
					For repeated, serious, or unresolved violations, we may temporarily
					suspend your account. Your storefront remains accessible (so in-flight
					orders complete), but you cannot send new broadcasts or accept new
					orders. We'll notify you and outline what's required to restore the
					account.
				</p>

				<h3 className="text-lg font-semibold">6.3 Permanent suspension</h3>
				<p>
					For egregious violations (illegal content, willful spam, attempts to
					bypass safeguards), we will permanently suspend your account. We may
					notify Meta and other relevant platforms if your conduct violated
					their policies as well. You forfeit any prepaid subscription fees for
					the remainder of your billing period.
				</p>

				<h3 className="text-lg font-semibold">6.4 Appeals</h3>
				<p>
					You may appeal any enforcement action by emailing {contactLink} within
					30 days. We commit to responding within 7 business days. Our decision
					after appeal is final.
				</p>

				<h3 className="text-lg font-semibold">
					6.5 Immediate suspension without warning
				</h3>
				<p>
					We reserve the right to suspend an account immediately, without
					warning, in cases involving: illegal content, threats of violence,
					child safety violations, Meta WABA-suspending behavior, suspected
					fraud, or anything that threatens the integrity of the Kedaipal
					platform.
				</p>
			</section>

			<section className="space-y-3">
				<h2 className="text-2xl font-semibold tracking-tight">
					7. Your responsibilities for the content you publish
				</h2>
				<p>You are responsible for:</p>
				<ul className="list-disc space-y-2 pl-6">
					<li>
						All products, prices, descriptions, and images you publish on your
						storefront.
					</li>
					<li>All WhatsApp messages sent through your Kedaipal account.</li>
					<li>The legality of the goods or services you sell.</li>
					<li>
						Honoring your customers' purchases, refund requests, and data
						requests.
					</li>
					<li>
						Complying with all applicable Malaysian consumer protection, tax,
						and data protection laws.
					</li>
				</ul>
				<p>
					Kedaipal is a tool. We do not sell your goods, we do not handle your
					customer service, and we are not liable for the content you publish or
					the transactions you conduct.
				</p>
			</section>

			<section className="space-y-3">
				<h2 className="text-2xl font-semibold tracking-tight">
					8. Reporting violations
				</h2>
				<p>
					If you believe another Kedaipal retailer is violating this AUP, or if
					you are a customer who has received unwanted messages, please email{" "}
					{contactLink} with:
				</p>
				<ul className="list-disc space-y-2 pl-6">
					<li>The retailer's store name or storefront URL</li>
					<li>A description of the issue</li>
					<li>Any supporting evidence (screenshots, message copies)</li>
				</ul>
				<p>
					We will investigate every report and respond within 7 business days.
				</p>
			</section>

			<section className="space-y-3">
				<h2 className="text-2xl font-semibold tracking-tight">
					9. Changes to this policy
				</h2>
				<p>
					We may update this AUP from time to time. When we make material
					changes, we will:
				</p>
				<ul className="list-disc space-y-2 pl-6">
					<li>
						Email all active retailers at least 30 days before the changes take
						effect
					</li>
					<li>Update the "Last updated" date at the top of this page</li>
					<li>
						Require re-acceptance of the updated policy on your next login (when
						changes are material)
					</li>
				</ul>
				<p>
					Continued use of Kedaipal after the effective date constitutes
					acceptance.
				</p>
			</section>

			<section className="space-y-3">
				<h2 className="text-2xl font-semibold tracking-tight">10. Contact</h2>
				<p>
					Questions about this policy? Concerns about another retailer's
					conduct? Reach us at {contactLink}.
				</p>
			</section>

			<section className="space-y-3">
				<p className="text-sm text-muted-foreground">
					This Acceptable Use Policy is supplementary to and incorporated into
					our{" "}
					<Link to="/terms" className="underline hover:text-foreground">
						Terms &amp; Conditions
					</Link>{" "}
					and{" "}
					<Link to="/privacy" className="underline hover:text-foreground">
						Privacy Policy
					</Link>
					. In the event of any conflict, the Terms &amp; Conditions govern.
				</p>
			</section>
		</LegalLayout>
	);
}
