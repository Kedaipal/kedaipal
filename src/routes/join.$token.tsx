import { useAuth, useClerk } from "@clerk/tanstack-react-start";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation } from "convex/react";
import {
	ArrowRight,
	CheckCircle2,
	Clock,
	MailQuestion,
	MessageCircle,
	Store,
	UsersRound,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "../../convex/_generated/api";
import { OnboardingTopBar } from "../components/onboarding/onboarding-top-bar";
import { Button } from "../components/ui/button";
import { convexErrorMessage } from "../lib/format";

/**
 * /join/<token> — where a team invitation lands (86exr91r4).
 *
 * A PAGE, not a modal: the link arrives from an email into a cold browser with
 * no app underneath. Every outcome the server can answer gets its own copy and
 * its own next step — valid (accept), expired/used/invalid (ask for a new
 * link), signed in with the wrong inbox (switch accounts), and the two
 * one-store conflicts, which explain the rule and offer the WhatsApp-the-
 * inviter CTA instead of a dead end. Accepting NEVER touches the blocking
 * store — ending a store relationship is always an explicit act elsewhere.
 */

export const Route = createFileRoute("/join/$token")({
	head: () => ({
		meta: [
			{ title: "Team invitation — Kedaipal" },
			{ name: "robots", content: "noindex, nofollow" },
		],
	}),
	component: JoinPage,
});

function JoinPage() {
	const { token } = Route.useParams();
	const context = useQuery(
		convexQuery(api.team.getInviteContext, { token }),
	).data;

	return (
		<main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-6 px-5 py-6">
			<OnboardingTopBar />
			<div className="flex flex-1 flex-col justify-center pb-16">
				{context === undefined ? (
					<div className="h-64 animate-pulse rounded-2xl border border-border bg-muted/40" />
				) : context.state === "invalid" ? (
					<StateCard
						icon={<MailQuestion className="size-5" />}
						title="This invitation link isn't valid"
						body="It may have been cancelled, replaced by a newer one, or typed out by hand. Ask the store owner to send you a fresh invitation."
					>
						<Button asChild variant="outline" className="h-11 w-full">
							<Link to="/">Go to Kedaipal</Link>
						</Button>
					</StateCard>
				) : context.state === "expired" ? (
					<StateCard
						icon={<Clock className="size-5" />}
						title="This invitation has expired"
						body={`Invitations last 7 days. Ask ${context.storeName} to resend it — the new email will carry a fresh link.`}
					>
						<Button asChild variant="outline" className="h-11 w-full">
							<Link to="/">Go to Kedaipal</Link>
						</Button>
					</StateCard>
				) : context.state === "used" ? (
					<StateCard
						icon={<CheckCircle2 className="size-5" />}
						title="This invitation was already used"
						body={`Someone already joined ${context.storeName} with this link. If that was you, just sign in — your seat is waiting.`}
					>
						<Button asChild className="h-11 w-full">
							<Link to="/sign-in/$" params={{ _splat: "" }}>
								Sign in <ArrowRight className="size-4" />
							</Link>
						</Button>
					</StateCard>
				) : (
					<ValidInvite token={token} context={context} />
				)}
			</div>
		</main>
	);
}

function ValidInvite({
	token,
	context,
}: {
	token: string;
	context: {
		state: "valid";
		storeName: string;
		invitedEmail: string;
		expiresAt?: number;
		ownerWaPhone?: string;
		viewer: {
			signedIn: boolean;
			emailMatches?: boolean;
			ownsStore?: string;
			memberOf?: string;
		};
	};
}) {
	// The SERVER's view (context.viewer) is authoritative for every STORE fact —
	// which store blocks the accept, whether the email matches. But it lags
	// Clerk by however long the Convex client takes to attach the auth token,
	// and during that window `viewer.signedIn` is false for a signed-IN person.
	// Rendering the signed-out CTAs off it flashed "Create your login to accept"
	// at the store's own owner for several seconds (found driving Chrome,
	// 25 Sep). So Clerk answers "is anyone signed in?" — it knows first — and
	// the server answers everything else, once it has caught up.
	const { isLoaded, isSignedIn } = useAuth();
	const { signOut } = useClerk();
	const navigate = useNavigate();
	const acceptInvite = useMutation(api.team.acceptInvite);
	const [accepting, setAccepting] = useState(false);
	const [refusal, setRefusal] = useState<string | null>(null);

	// Settled = Clerk has loaded AND, if someone is signed in, the server can
	// see them too. Until then we show a placeholder rather than a wrong door.
	const authSettled = isLoaded && (!isSignedIn || context.viewer.signedIn);
	const redirectBack = `/join/${token}`;
	const waLink = context.ownerWaPhone
		? `https://wa.me/${context.ownerWaPhone.replace(/\D/g, "")}?text=${encodeURIComponent(
				`Hi! About the Kedaipal team invitation for ${context.storeName} — `,
			)}`
		: null;

	const accept = async () => {
		setAccepting(true);
		try {
			const result = await acceptInvite({ token });
			if (result.ok) {
				toast.success(`Welcome to ${result.storeName}!`);
				navigate({ to: "/app" });
				return;
			}
			// Refusals are expected human situations, each with its own copy —
			// the mutation returns them rather than throwing (see convex/team.ts).
			setRefusal(
				result.reason === "no_seat"
					? `${context.storeName} no longer has a free seat — their plan changed after this invitation was sent. Ask the owner to free a seat or upgrade, then have them resend the invite.`
					: result.reason === "email_mismatch"
						? `This invitation is for ${result.invitedEmail ?? context.invitedEmail}, but you're signed in with a different email. Sign out and use the invited inbox.`
						: result.reason === "expired"
							? "The invitation expired just now — ask the owner to resend it."
							: result.reason === "own_store" ||
									result.reason === "other_membership"
								? conflictCopy(result.storeName, context.storeName)
								: "This invitation is no longer valid — ask the owner to send a new one.",
			);
		} catch (err) {
			toast.error(convexErrorMessage(err));
		} finally {
			setAccepting(false);
		}
	};

	// The three signed-in blockers, surfaced BEFORE the accept button so nobody
	// taps into a refusal they could see coming.
	const blocker = !context.viewer.signedIn
		? null
		: context.viewer.ownsStore
			? {
					title: `This login already runs ${context.viewer.ownsStore}`,
					body: `A Kedaipal login runs one store — owned or joined, never both. Joining ${context.storeName} would need this store closed first, and accepting an invitation never touches your store or its subscription by itself.`,
				}
			: context.viewer.memberOf
				? {
						title: `You're already on the team at ${context.viewer.memberOf}`,
						body: `A Kedaipal login works in one store at a time. Leave ${context.viewer.memberOf} first (Settings → Team → Leave), then open this link again.`,
					}
				: context.viewer.emailMatches === false
					? {
							title: "You're signed in with a different email",
							body: `This invitation is for ${context.invitedEmail}. Sign out, then sign in with that inbox to accept.`,
						}
					: null;

	return (
		<div className="flex flex-col gap-4">
			<StateCard
				icon={<UsersRound className="size-5" />}
				title={`Join the team at ${context.storeName}`}
				body={`${context.storeName} invited ${context.invitedEmail} to help run their Kedaipal store. You'll work from your own login — the owner controls what you can open, and billing stays theirs.`}
			>
				{refusal ? (
					<p className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-left text-xs leading-relaxed text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
						{refusal}
					</p>
				) : null}

				{!authSettled ? (
					<div className="h-24 animate-pulse rounded-xl bg-muted/50" />
				) : !context.viewer.signedIn ? (
					<>
						{/* Plain <a>: Clerk's pages read ?redirect_url= from the URL, and
						    these are full-page auth flows anyway. sign-in honours it now
						    that its force-redirect is gone (this feature's fix). */}
						<Button asChild className="h-11 w-full">
							<a
								href={`/sign-up?redirect_url=${encodeURIComponent(redirectBack)}`}
							>
								Create your login to accept <ArrowRight className="size-4" />
							</a>
						</Button>
						<Button asChild variant="outline" className="h-11 w-full">
							<a
								href={`/sign-in?redirect_url=${encodeURIComponent(redirectBack)}`}
							>
								I already have a Kedaipal login
							</a>
						</Button>
						<p className="text-[11px] text-muted-foreground">
							Sign in with <strong>{context.invitedEmail}</strong> — the
							invitation only works for that inbox.
						</p>
					</>
				) : blocker ? (
					<div className="flex flex-col gap-3 text-left">
						<div className="rounded-xl border border-border bg-muted/50 p-3">
							<p className="flex items-center gap-2 text-sm font-semibold">
								<Store className="size-4 shrink-0" /> {blocker.title}
							</p>
							<p className="mt-1 text-xs leading-relaxed text-muted-foreground">
								{blocker.body}
							</p>
						</div>
						{context.viewer.emailMatches === false ? (
							<Button
								variant="outline"
								className="h-11 w-full"
								onClick={() => signOut({ redirectUrl: redirectBack })}
							>
								Sign out & switch account
							</Button>
						) : null}
						{waLink ? (
							<Button asChild variant="outline" className="h-11 w-full">
								<a href={waLink} target="_blank" rel="noopener noreferrer">
									<MessageCircle className="size-4" /> Message{" "}
									{context.storeName} on WhatsApp
								</a>
							</Button>
						) : null}
						{context.viewer.ownsStore ? (
							<Button asChild variant="ghost" className="h-11 w-full">
								<Link to="/app">Keep my store & open my dashboard</Link>
							</Button>
						) : null}
					</div>
				) : (
					<Button className="h-11 w-full" disabled={accepting} onClick={accept}>
						{accepting ? "Joining…" : `Join ${context.storeName}`}
						<ArrowRight className="size-4" />
					</Button>
				)}
			</StateCard>
		</div>
	);
}

function conflictCopy(
	blockingStore: string | undefined,
	inviteStore: string,
): string {
	return blockingStore
		? `This login already belongs to ${blockingStore}. A Kedaipal login runs one store at a time — leave or close that one first, then open this link again to join ${inviteStore}.`
		: `This login already belongs to another store — a Kedaipal login runs one store at a time.`;
}

function StateCard({
	icon,
	title,
	body,
	children,
}: {
	icon: React.ReactNode;
	title: string;
	body: string;
	children?: React.ReactNode;
}) {
	return (
		<div className="flex flex-col items-center gap-3 rounded-2xl border border-border bg-card p-6 text-center shadow-sm">
			<span className="flex size-12 items-center justify-center rounded-full bg-accent/12 text-accent">
				{icon}
			</span>
			<h1 className="font-heading text-lg font-extrabold">{title}</h1>
			<p className="text-sm leading-relaxed text-muted-foreground">{body}</p>
			<div className="mt-2 flex w-full flex-col gap-2">{children}</div>
		</div>
	);
}
