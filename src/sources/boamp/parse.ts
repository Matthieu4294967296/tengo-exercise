import { XMLParser } from 'fast-xml-parser';
import type { Lot, MarketType, NormalizedNotice } from '../../domain/notice.ts';
import { cleanOptional, parseParisIsoDateTime } from '../../lib/text.ts';
import { SOURCES } from '../registry.ts';

// fast-xml-parser turns the XML into nested plain objects.
// Empty tags like <fournitures/> become an empty string.
// Repeated tags listed in `isArray` are always arrays, even when there is only one.
const xmlParser = new XMLParser({
  ignoreAttributes: true,
  removeNSPrefix: true,
  trimValues: true,
  isArray: (name) => name === 'lot',
});

const MARKET_TYPE_TAGS: Record<string, MarketType> = {
  fournitures: 'supplies',
  travaux: 'works',
  services: 'services',
};

type XmlObject = Record<string, unknown>;

export function parseBoampXml(xml: string): NormalizedNotice {
  const root = asObject(xmlParser.parse(xml));
  const ann = asObject(root?.ann) ?? root;
  const donnees = asObject(ann?.DONNEES);
  const mapa = asObject(donnees?.MAPA);
  const organisme = asObject(mapa?.organisme);
  const initial = asObject(mapa?.initial);
  const gestion = asObject(ann?.GESTION);
  const reference = asObject(gestion?.REFERENCE);
  const indexation = asObject(gestion?.INDEXATION);

  const externalId = text(reference?.IDWEB);
  if (!externalId) {
    throw new Error('BOAMP notice is missing GESTION/REFERENCE/IDWEB');
  }

  const description = asObject(initial?.description);
  const title = text(description?.objet) ?? text(indexation?.RESUME_OBJET);
  if (!title) {
    throw new Error(`BOAMP notice ${externalId} is missing a title`);
  }

  const buyerName = text(organisme?.acheteurPublic) ?? text(indexation?.NOMORGANISME);
  if (!buyerName) {
    throw new Error(`BOAMP notice ${externalId} is missing a buyer name`);
  }

  const adr = asObject(organisme?.adr);
  const coord = asObject(organisme?.coord);
  const caracteristiques = asObject(initial?.caracteristiques);
  const procedure = asObject(initial?.procedure);
  const renseignements = asObject(initial?.renseignements);

  return {
    source: SOURCES.boamp.key,
    externalId,
    url: `https://www.boamp.fr/avis/detail/${externalId}/officiel`,
    externalRefs: [],
    buyer: {
      name: buyerName,
      address: formatAddress(adr),
      postalCode: text(adr?.cp),
      city: text(adr?.ville),
      email: text(coord?.mel),
      phone: text(coord?.tel),
      website: buyerWebsite(text(coord?.url)),
    },
    title,
    description: text(caracteristiques?.principales),
    buyerReference: text(renseignements?.idMarche),
    marketType: parseMarketType(asObject(initial?.natureMarche)),
    procedure: procedure && 'procedureAdaptee' in procedure ? 'Procédure adaptée' : undefined,
    publicationDate: text(indexation?.DATE_PUBLICATION),
    responseDeadline: parseParisIsoDateTime(
      text(indexation?.DATE_LIMITE_REPONSE) ?? text(asObject(initial?.delais)?.receptionOffres) ?? '',
    ),
    executionPlace: formatAddress(description?.lieuLivraison ?? description?.lieuExecution),
    duration: parseDuration(asObject(initial?.duree)),
    cpvCodes: [],
    lots: parseLots(asObject(initial?.lots)),
  };
}

function parseMarketType(nature: XmlObject | undefined): MarketType | undefined {
  if (!nature) return undefined;
  for (const [tag, marketType] of Object.entries(MARKET_TYPE_TAGS)) {
    if (tag in nature) return marketType;
  }
  return undefined;
}

function parseDuration(duree: XmlObject | undefined): string | undefined {
  if (!duree) return undefined;
  const months = text(duree.nbMois);
  if (months) return `${months} mois`;
  const from = text(duree.dateACompterDu);
  const to = text(duree.dateJusquau);
  if (from && to) return `${from} - ${to}`;
  return undefined;
}

function parseLots(lotsNode: XmlObject | undefined): Lot[] {
  const lots = asArray(lotsNode?.lot);
  return lots.flatMap((item) => {
    const lot = asObject(item);
    if (!lot) return [];
    const number = text(lot.numLot);
    if (!number) return [];
    const raw = typeof lot.description === 'string' ? lot.description : '';
    const lines = raw.split('\n').map((line) => line.trim()).filter(Boolean);
    return [
      {
        number,
        title: lines[0],
        description: lines.length > 1 ? lines.slice(1).join(' ') : undefined,
      },
    ];
  });
}

/** Drop the buyer-profile URL when BOAMP stored it in the website field. */
function buyerWebsite(url: string | undefined): string | undefined {
  if (!url) return undefined;
  if (url.includes('marches-publics.info')) return undefined;
  return url;
}

function formatAddress(node: unknown): string | undefined {
  const address = asObject(node);
  if (!address) return undefined;
  const street = text(asObject(address.voie)?.nomvoie);
  return cleanOptional([street, text(address.cp), text(address.ville)].filter(Boolean).join(', '));
}

function text(value: unknown): string | undefined {
  // fast-xml-parser turns <cp>78450</cp> and <nbMois>1</nbMois> into numbers.
  if (typeof value === 'string') return cleanOptional(value);
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
}

function asObject(value: unknown): XmlObject | undefined {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as XmlObject;
  }
  return undefined;
}

function asArray(value: unknown): unknown[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}
