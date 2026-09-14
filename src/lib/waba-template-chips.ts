/**
 * How the admin console's Message-templates panel colours and labels one
 * template's state (ClickUp z8r3fddtkh). Pure, so the rules are testable
 * without rendering the admin route — the house pattern for route logic.
 *
 * The three chips answer three different questions, and only one of them is
 * about money: **billed as** is the 6.1× question (utility RM 0.0564 vs
 * marketing RM 0.3467 per send from 1 Oct 2026).
 */

export type Tone = "ok" | "warn" | "bad" | "muted";

export const TONE_CLASS: Record<Tone, string> = {
	ok: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300",
	warn: "bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300",
	bad: "bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-300",
	muted: "bg-muted text-muted-foreground",
};

/** Statuses where every send naming the template fails outright. */
const BAD_STATUS = new Set([
	"PAUSED",
	"DISABLED",
	"REJECTED",
	"PENDING_DELETION",
	"FLAGGED",
]);

/** Categories billed at the low rate; anything else is marketing-priced. */
const LOW_RATE = new Set(["UTILITY", "AUTHENTICATION", "SERVICE"]);

export function statusTone(status: string | undefined): Tone {
	if (!status) return "muted";
	if (status === "APPROVED") return "ok";
	if (BAD_STATUS.has(status)) return "bad";
	return "warn"; // PENDING, IN_APPEAL, …
}

export function categoryTone(category: string | undefined): Tone {
	if (!category) return "muted";
	return LOW_RATE.has(category) ? "ok" : "bad";
}

export function qualityTone(quality: string | undefined): Tone {
	if (!quality) return "muted";
	if (quality === "GREEN") return "ok";
	if (quality === "RED") return "bad";
	if (quality === "YELLOW") return "warn";
	return "muted";
}

/**
 * What the "billed as" chip says.
 *
 * Meta only posts `template_category_update` when it CHANGES a category —
 * there is no event announcing the category a template was approved under —
 * so a healthy template would otherwise read "unknown" for ever, leaving the
 * panel's most important column permanently blank.
 *
 * Every template this deployment registers is a utility one (each send goes
 * out under the `utility_template` category), so for a CONFIGURED template
 * utility is the truth until Meta says otherwise. It is labelled "assumed"
 * and left muted rather than green, because we were told nothing — and a
 * template we do not configure gets no such benefit of the doubt.
 */
export function categoryChip(
	category: string | undefined,
	configured: boolean,
): { value: string; tone: Tone } {
	if (category) return { value: category, tone: categoryTone(category) };
	if (configured) return { value: "UTILITY (assumed)", tone: "muted" };
	return { value: "unknown", tone: "muted" };
}
