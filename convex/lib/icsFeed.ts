// Pure ICS (RFC 5545) builder for the seller's booking calendar feed
// (booking bundle S6, `86eyn4kf2`; spec 86eyj70z1 — ONE-WAY subscribe, locked
// 12 Aug: Google pulls this URL on its own schedule; nothing ever writes
// back, and a feed failure can never touch an order).
//
// Every event is an ALL-DAY date-range event on MYT calendar days:
// `DTSTART;VALUE=DATE` dates are floating (no timezone), which is exactly
// right for "the 25th" meaning the seller's 25th. A stay's exclusive
// `checkOut` maps 1:1 onto ICS's exclusive DTEND; an INCLUSIVE block end gets
// +1 day at the call site. UIDs are STABLE (shortId / block id), so a
// re-fetch updates events in place instead of duplicating them.

import { DAY_MS, MYT_OFFSET_MS } from "./fulfilmentDate";

/** Escape text for an ICS property value (RFC 5545 §3.3.11). */
export function escapeIcsText(value: string): string {
	return value
		.replace(/\\/g, "\\\\")
		.replace(/;/g, "\\;")
		.replace(/,/g, "\\,")
		.replace(/\r?\n/g, "\\n");
}

/** MYT-midnight epoch-ms → the ICS DATE form of that MYT calendar day. */
export function icsDate(mytMidnight: number): string {
	const d = new Date(mytMidnight + MYT_OFFSET_MS);
	const y = d.getUTCFullYear();
	const m = String(d.getUTCMonth() + 1).padStart(2, "0");
	const day = String(d.getUTCDate()).padStart(2, "0");
	return `${y}${m}${day}`;
}

/** Epoch-ms → the ICS UTC date-time form (DTSTAMP). */
export function icsUtcStamp(epochMs: number): string {
	const d = new Date(epochMs);
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

/**
 * Fold a content line at 75 octets (RFC 5545 §3.1) — continuation lines start
 * with one space. Folds on characters, which stays within the octet limit for
 * our ASCII-heavy lines and is accepted by every consumer for multi-byte text.
 */
export function foldIcsLine(line: string): string {
	if (line.length <= 75) return line;
	const parts: string[] = [line.slice(0, 75)];
	let rest = line.slice(75);
	while (rest.length > 74) {
		parts.push(` ${rest.slice(0, 74)}`);
		rest = rest.slice(74);
	}
	if (rest.length > 0) parts.push(` ${rest}`);
	return parts.join("\r\n");
}

export type IcsEvent = {
	/** Stable UID body (the builder appends `@kedaipal.com`). */
	uid: string;
	/** Raw summary — escaped by the builder. NEVER include a phone number:
	 * a feed URL can be forwarded, so the feed carries name-level PII only. */
	summary: string;
	/** First covered MYT day (midnight epoch-ms). */
	start: number;
	/** EXCLUSIVE end day (midnight epoch-ms) — the day after the last covered
	 * night, matching both `bookingCheckOut` and ICS DTEND semantics. */
	endExclusive: number;
	/** Row creation time — the stable DTSTAMP, so an unchanged feed byte-
	 * compares equal across fetches and Google never sees phantom updates. */
	createdAt: number;
	/** Minutes past MYT midnight when this is a TIMED event rather than an
	 * all-day one (a delivery due at 3:30 PM). Absent = all-day. A calendar
	 * showing twelve Saturday deliveries is far more useful with the times on
	 * them, and MYT is UTC+8 with no DST, so the UTC form is exact. */
	startMinutes?: number;
	/** How long a timed event runs. Defaults to 60 minutes. */
	durationMinutes?: number;
	/** Deep link to the order in the dashboard. Emitted as both `URL` and the
	 * tail of `DESCRIPTION`: Google Calendar renders `URL` inconsistently
	 * (mobile often ignores it), and a seller looking at "Aisyah — Campsite" on
	 * their phone should be one tap from the order rather than hunting for it
	 * in the inbox. Safe to carry — the target is Clerk-gated, so the link
	 * exposes only a shortId, and a forwarded feed still can't open it. */
	url?: string;
};

/** Assemble the complete VCALENDAR document (CRLF line endings). */
export function buildIcsCalendar(args: {
	calendarName: string;
	events: IcsEvent[];
}): string {
	const lines: string[] = [
		"BEGIN:VCALENDAR",
		"VERSION:2.0",
		"PRODID:-//Kedaipal//Booking Calendar//EN",
		"CALSCALE:GREGORIAN",
		"METHOD:PUBLISH",
		foldIcsLine(`X-WR-CALNAME:${escapeIcsText(args.calendarName)}`),
		"X-WR-TIMEZONE:Asia/Kuala_Lumpur",
	];
	for (const event of args.events) {
		lines.push(
			"BEGIN:VEVENT",
			foldIcsLine(`UID:${event.uid}@kedaipal.com`),
			`DTSTAMP:${icsUtcStamp(event.createdAt)}`,
			...(event.startMinutes === undefined
				? [
						`DTSTART;VALUE=DATE:${icsDate(event.start)}`,
						`DTEND;VALUE=DATE:${icsDate(event.endExclusive)}`,
					]
				: (() => {
						const startMs = event.start + event.startMinutes * 60_000;
						const endMs =
							startMs + (event.durationMinutes ?? 60) * 60_000;
						return [
							`DTSTART:${icsUtcStamp(startMs)}`,
							`DTEND:${icsUtcStamp(endMs)}`,
						];
					})()),
			foldIcsLine(`SUMMARY:${escapeIcsText(event.summary)}`),
			...(event.url
				? [
						foldIcsLine(`URL:${escapeIcsText(event.url)}`),
						foldIcsLine(
							`DESCRIPTION:${escapeIcsText(`Open in Kedaipal: ${event.url}`)}`,
						),
					]
				: []),
			"TRANSP:OPAQUE",
			"END:VEVENT",
		);
	}
	lines.push("END:VCALENDAR");
	return `${lines.join("\r\n")}\r\n`;
}

/** Convenience for blocks: inclusive end day → the exclusive form. */
export function inclusiveEndToExclusive(endInclusive: number): number {
	return endInclusive + DAY_MS;
}
