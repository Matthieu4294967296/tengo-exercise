// Helpers shared by the parsers and the matcher.

/** Collapses whitespace (including newlines) to single spaces and trims. */
export function cleanText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/** Like cleanText, but returns undefined for empty input. */
export function cleanOptional(value: string | undefined | null): string | undefined {
  if (value === undefined || value === null) return undefined;
  const cleaned = cleanText(value);
  return cleaned === '' ? undefined : cleaned;
}

/**
 * Turns free text into a stable comparison key:
 *   'Département du DOUBS' -> 'departement du doubs'
 *   "L' AMELIORATION - école"  -> 'l amelioration ecole'
 * Lowercase, accents removed, anything that is not a letter or digit becomes a
 * space, spaces collapsed. Used for buyer names and titles in match keys.
 */
export function normalizeKey(value: string): string {
  return value
    .normalize('NFD') // split 'é' into 'e' + combining accent
    .replace(/[\u0300-\u036f]/g, '') // drop the combining accents
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// --- Dates -----------------------------------------------------------------
//
// Both sources give Paris local time without an offset ('2024-05-27T12:00:00',
// '27/05/24 à 12h00'). We convert to real instants (UTC) once, at parse time,
// so the rest of the code and the API never have to think about time zones.

const TZ_PARIS = 'Europe/Paris';

/** Offset of Europe/Paris from UTC, in minutes, at the given instant (+60 or +120). */
function parisOffsetMinutes(at: Date): number {
  const label = new Intl.DateTimeFormat('en-US', { timeZone: TZ_PARIS, timeZoneName: 'longOffset' })
    .formatToParts(at)
    .find((part) => part.type === 'timeZoneName')?.value; // 'GMT+02:00'
  const match = label ? /GMT([+-])(\d{2}):(\d{2})/.exec(label) : null;
  if (!match) return 0;
  const sign = match[1] === '-' ? -1 : 1;
  return sign * (Number(match[2]) * 60 + Number(match[3]));
}

/** Builds the UTC instant for a Paris wall-clock time. Month is 1-based. */
export function parisToUtc(year: number, month: number, day: number, hour: number, minute: number): Date {
  // Pretend the wall time is UTC, then shift by the Paris offset in force at that moment.
  const naive = Date.UTC(year, month - 1, day, hour, minute);
  const offset = parisOffsetMinutes(new Date(naive));
  return new Date(naive - offset * 60_000);
}

/** '2024-05-27T12:00:00' (Paris local, as in BOAMP XML) -> UTC Date. */
export function parseParisIsoDateTime(value: string): Date | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value.trim());
  if (!match) return undefined;
  const [, y, m, d, h, mi] = match.map(Number);
  return parisToUtc(y, m, d, h, mi);
}

/** '27/05/24 à 12h00' or '27/05/2024 à 12h00' (as on marches-publics.info) -> UTC Date. */
export function parseFrenchDateTime(value: string): Date | undefined {
  const match = /(\d{2})\/(\d{2})\/(\d{2,4})\s*à\s*(\d{1,2})h(\d{2})/.exec(value);
  if (!match) return undefined;
  const [, d, m, y, h, mi] = match.map(Number);
  return parisToUtc(fullYear(y), m, d, h, mi);
}

/** '22/04/24' or '22/04/2024' -> '2024-04-22'. A calendar date, no time zone involved. */
export function parseFrenchDate(value: string): string | undefined {
  const match = /(\d{2})\/(\d{2})\/(\d{2,4})/.exec(value);
  if (!match) return undefined;
  const [, d, m, y] = match;
  return `${fullYear(Number(y))}-${m}-${d}`;
}

/** 24 -> 2024; 2024 -> 2024. */
function fullYear(year: number): number {
  return year < 100 ? 2000 + year : year;
}
