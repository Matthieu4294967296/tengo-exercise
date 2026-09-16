import { load, type CheerioAPI } from 'cheerio';
import type { Buyer, CpvCode, Lot, MarketType, NormalizedNotice } from '../../domain/notice.ts';
import { cleanOptional, cleanText, parseFrenchDate, parseFrenchDateTime } from '../../lib/text.ts';
import { SOURCES } from '../registry.ts';

export interface PlatformPageMeta {
  file: string;
  url: string;
  fetchedAt: string;
}

const MARKET_TYPE_LABELS: Record<string, MarketType> = {
  fournitures: 'supplies',
  services: 'services',
  travaux: 'works',
};

/**
 * Parse a marches-publics.info notice page.
 * Fields are found by the label in the left-hand cell.
 */
export function parsePlatformHtml(html: string, meta: PlatformPageMeta): NormalizedNotice {
  const $ = load(html);
  const root = $('#AAPCGenere');
  const scope: CheerioAPI = root.length ? load(root.html() ?? '') : $;

  const title = cellAfter(scope, 'Objet');
  if (!title) {
    throw new Error(`Platform page ${meta.file} is missing Objet`);
  }

  const buyer = parseBuyer(scope);
  if (!buyer.name) {
    throw new Error(`Platform page ${meta.file} is missing a buyer name`);
  }

  const boampId = linkedBoampId($);
  const pageText = scope.text();

  return {
    source: SOURCES['marches-publics.info'].key,
    externalId: meta.file.replace(/\.html$/i, ''),
    url: meta.url,
    fetchedAt: new Date(meta.fetchedAt),
    externalRefs: boampId ? [{ source: SOURCES.boamp.key, externalId: boampId }] : [],
    buyer,
    title,
    description: cellAfter(scope, 'Description'),
    buyerReference: cellAfter(scope, 'Référence'),
    marketType: parseMarketType(cellAfter(scope, 'Type de marché')),
    procedure: parseProcedure(cellAfter(scope, 'Mode')),
    publicationDate: parsePublicationDate(pageText),
    responseDeadline: parseFrenchDateTime(rowTextContaining(scope, 'Remise des offres') ?? ''),
    executionPlace:
      cellAfter(scope, "Lieu d'exécution principal") ?? cellAfter(scope, 'Lieu de livraison principal'),
    duration: cellAfter(scope, 'Durée'),
    cpvCodes: parseCpvCodes(scope),
    lots: parseLots(scope),
  };
}

function parseBuyer($: CheerioAPI): Buyer {
  // The buyer block is the cell that contains the SIRET line.
  let name: string | undefined;
  let address: string | undefined;
  let postalCode: string | undefined;
  let city: string | undefined;
  let siret: string | undefined;
  let phone: string | undefined;
  let website: string | undefined;

  $('td').each((_, el) => {
    const text = $(el).text();
    if (!/SIRET/i.test(text)) return;
    name = cleanOptional($(el).find('b').first().text()) ?? name;
    siret = /SIRET\s+(\d{14})/i.exec(text)?.[1] ?? siret;
    phone = /Tél\s*:\s*([\d .]+)/i.exec(text)?.[1]?.trim() ?? phone;
    // The site URL is on the <a> wrapping an <img title="Site internet de l'acheteur">.
    const siteImg = $(el)
      .find('img')
      .filter((_, img) => $(img).attr('title') === "Site internet de l'acheteur");
    website = siteImg.parent('a').attr('href') ?? website;

    const lines = text
      .split('\n')
      .map((line) => cleanText(line))
      .filter(Boolean);
    const place = lines.map((line) => /^(\d{5})\s+(.+)$/.exec(line)).find(Boolean);
    if (place) {
      postalCode = place[1];
      city = place[2];
    }
    const street = lines.find(
      (line) =>
        line !== name &&
        !/^SIRET/i.test(line) &&
        !/^Tél/i.test(line) &&
        !/^\d{5}\s/.test(line) &&
        !/^(Mme|M\.|Monsieur|Madame)\b/i.test(line),
    );
    address = street ?? address;
    return false;
  });

  return { name: name ?? '', siret, address, postalCode, city, phone, website };
}

function parseMarketType(label: string | undefined): MarketType | undefined {
  if (!label) return undefined;
  return MARKET_TYPE_LABELS[label.toLowerCase()];
}

function parseProcedure(mode: string | undefined): string | undefined {
  if (!mode) return undefined;
  if (/adapt[eé]e/i.test(mode)) return 'Procédure adaptée';
  return mode;
}

function parseCpvCodes($: CheerioAPI): CpvCode[] {
  const codes: CpvCode[] = [];
  const main = parseCpvCell(cellAfter($, 'Code CPV principal'));
  if (main) codes.push({ ...main, isMain: true });

  let readingComplementary = false;
  $('tr').each((_, tr) => {
    const cells = $(tr).children('td');
    if (cells.length < 2) return;
    const left = cleanText($(cells[0]).text());
    if (/^Code CPV complémentaire$/i.test(left)) {
      readingComplementary = true;
      const parsed = parseCpvCell($(cells[1]).text());
      if (parsed) codes.push({ ...parsed, isMain: false });
      return;
    }
    if (readingComplementary && left === '') {
      const parsed = parseCpvCell($(cells[1]).text());
      if (parsed) codes.push({ ...parsed, isMain: false });
      return;
    }
    if (readingComplementary && left !== '') {
      readingComplementary = false;
    }
  });
  return codes;
}

function parseCpvCell(value: string | undefined): { code: string; label?: string } | undefined {
  if (!value) return undefined;
  const match = /(\d{8})\s*(?:-\s*)?(.*)/.exec(value);
  if (!match) return undefined;
  return { code: match[1], label: cleanOptional(match[2]) };
}

function parseLots($: CheerioAPI): Lot[] {
  const lots: Lot[] = [];
  $('tr').each((_, tr) => {
    const first = cleanText($(tr).children('td').first().text());
    if (first !== 'Lots') return;
    let row = $(tr).next();
    while (row.length) {
      const cells = row.children('td');
      const numberMatch = /^N°\s*(\d+)/.exec(cleanText(cells.eq(0).text()));
      if (!numberMatch) break;
      const libelle = cleanText(cells.eq(1).text());
      const [title, description] = splitLibelle(libelle);
      const cpv = parseCpvCell(cells.last().text());
      lots.push({ number: numberMatch[1], title, description, cpvCode: cpv?.code });
      row = row.next();
    }
    return false;
  });
  return lots;
}

function splitLibelle(libelle: string): [string | undefined, string | undefined] {
  const parts = libelle.split(/Description\s*:/i).map((part) => cleanOptional(part));
  if (parts.length === 1) return [parts[0], undefined];
  return [parts[0], parts[1]];
}

function linkedBoampId($: CheerioAPI): string | undefined {
  const href = $('a[href*="boamp.fr/avis/detail/"]').first().attr('href');
  if (!href) return undefined;
  return /\/(\d{2}-\d+)/.exec(href)?.[1];
}

function cellAfter($: CheerioAPI, label: string): string | undefined {
  let found: string | undefined;
  $('tr').each((_, tr) => {
    const cells = $(tr).children('td');
    if (cells.length < 2) return;
    if (cleanText($(cells[0]).text()) === label) {
      found = cleanOptional($(cells[1]).text());
      return false;
    }
  });
  return found;
}

function parsePublicationDate(pageText: string): string | undefined {
  const match = /Envoi le\s+(\d{2}\/\d{2}\/\d{2,4})/.exec(pageText);
  if (match) return parseFrenchDate(match[1]);
  return undefined;
}

function rowTextContaining($: CheerioAPI, snippet: string): string | undefined {
  let found: string | undefined;
  $('tr').each((_, tr) => {
    const text = $(tr).text();
    if (text.includes(snippet)) {
      found = cleanText(text);
      return false;
    }
  });
  return found;
}
