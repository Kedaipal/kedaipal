/**
 * Copy for the two product options sellers kept confusing each other with
 * (ClickUp `86eyfq04j`): **mockup approval** and the **custom line**. Both used
 * to be titled after mockups ("Require mockup approval before making it" vs
 * "Also offer a custom / made-to-order option … with a mockup they approve"),
 * so the seller had to read three lines of prose to work out which was which.
 *
 * They answer different questions:
 *   - mockup approval → an extra APPROVAL STEP on the things you already sell;
 *   - custom line     → an extra THING TO SELL on this product.
 *
 * Titles are now two words each and no longer overlap; the bodies lead with
 * what happens, not with the feature name. "Mockup" stays in the approval
 * title on purpose — it's the word the order detail page and the buyer's
 * tracking page already use ("Awaiting mockup approval"), so the seller can
 * connect this switch to the state it produces.
 *
 * Lives here because the **wizard** (`product-wizard.tsx`, More options) and
 * the **full editor** (`variant-editor.tsx`, Advanced) both render these
 * toggles; they previously carried hand-copied near-duplicates that had already
 * drifted apart in wording.
 */

export const MOCKUP_APPROVAL_COPY = {
	title: "Mockup approval",
	body: "Before you start, the buyer signs off on a photo or mockup you send. The order can't be packed until they approve.",
	/** Advanced/More-options teaser fragment. */
	teaser: "Mockup approval",
} as const;

export const CUSTOM_LINE_COPY = {
	title: "Custom orders",
	body: "Adds a “Custom” line buyers can pick when nothing above fits. They describe what they want; you set the price and send a mockup before they pay.",
	/** Advanced/More-options teaser fragment. */
	teaser: "Custom orders",
} as const;
