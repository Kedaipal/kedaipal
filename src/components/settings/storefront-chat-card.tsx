import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { useStoreRole } from "../../hooks/usePermission";
import { convexErrorMessage } from "../../lib/format";
import { ToggleSwitch } from "../ui/toggle-switch";
import { Glance, SectionHeading } from "./settings-primitives";

/**
 * Settings → Store → the store page's "Ask on WhatsApp" button (z8r3fdvwcy).
 * The store home carries a buyer-initiated WhatsApp action by default — a
 * `wa.me` link to the store's own number — so this card is where the seller
 * LEARNS it is there and where they can switch it off. Sits beside the
 * marketplace listing: both are "what the public sees of my store" switches,
 * and both save on flip (a state, not a form).
 *
 * Owner-only (it publishes the store's number on the store page, the same
 * class as the WhatsApp tab): a teammate and an acting admin see the switch
 * disabled with the reason, never a refused save.
 *
 * The status line tells the truth, not just the switch: ON with no WhatsApp
 * number is not shown, and saying "Shown on your store page" there would lie
 * to the brand-new seller most likely to read it.
 */
export function StorefrontChatCard({
	enabled,
	hasWaPhone,
	onChange,
}: {
	enabled: boolean;
	/** The store has a WhatsApp number for the chat to go to. */
	hasWaPhone: boolean;
	onChange: (enabled: boolean) => Promise<unknown>;
}) {
	const role = useStoreRole();
	const [flipping, setFlipping] = useState(false);
	const ownerOnlyReason =
		role === "member"
			? "Only the store owner can change this — ask them to make the change."
			: role === "admin"
				? "View-only while you're acting as this store — whether buyers can message the owner is their call."
				: null;

	async function handleFlip(next: boolean) {
		setFlipping(true);
		try {
			await onChange(next);
			toast.success(
				next
					? "Ask on WhatsApp is back on your store page."
					: "Ask on WhatsApp is off — orders still arrive the same way.",
			);
		} catch (err) {
			toast.error(convexErrorMessage(err));
		} finally {
			setFlipping(false);
		}
	}

	return (
		<div className="flex flex-col gap-4">
			<SectionHeading
				title="Ask on WhatsApp"
				description="A buyer with a question reaches you from your store page, without hunting for your number."
				glance={
					enabled && hasWaPhone ? (
						<Glance>On</Glance>
					) : (
						<Glance tone="grey">{enabled ? "No number" : "Off"}</Glance>
					)
				}
			/>
			<div className="flex items-center justify-between gap-3">
				<div className="flex flex-col gap-0.5">
					<span className="text-sm font-medium">
						Let buyers message you from your store page
					</span>
					<span className="text-xs text-muted-foreground">
						Shows an Ask on WhatsApp button on your store. Orders still arrive
						the same way with it off.
					</span>
					<ChatStatusLine enabled={enabled} hasWaPhone={hasWaPhone} />
				</div>
				<ToggleSwitch
					on={enabled}
					disabled={flipping || ownerOnlyReason !== null}
					onChange={handleFlip}
					label="Let buyers message you from your store page"
				/>
			</div>
			{ownerOnlyReason ? (
				<p className="text-xs text-muted-foreground">{ownerOnlyReason}</p>
			) : null}
		</div>
	);
}

function ChatStatusLine({
	enabled,
	hasWaPhone,
}: {
	enabled: boolean;
	hasWaPhone: boolean;
}) {
	if (!enabled) {
		return (
			<span className="text-xs text-muted-foreground">
				Hidden from your store page. Buyers can still use Share.
			</span>
		);
	}
	if (!hasWaPhone) {
		return (
			<span className="text-xs text-muted-foreground">
				On, but not shown yet — buyers see it once your store has a WhatsApp
				number.{" "}
				<Link
					to="/app/settings"
					search={{ tab: "whatsapp" }}
					className="font-medium text-accent-emphasis underline underline-offset-2"
				>
					Add your number
				</Link>
			</span>
		);
	}
	return (
		<span className="text-xs text-muted-foreground">
			Shown on your store page, opening a chat with your store's WhatsApp
			number.
		</span>
	);
}
