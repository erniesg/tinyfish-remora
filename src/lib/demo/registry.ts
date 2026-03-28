import type { RecipeReadiness, RecipeSource, Venue } from "@/lib/demo/types";

export interface CountryRegistryEntry {
  id: string;
  name: string;
  region: string;
  locales: string[];
}

export interface SourceRegistryEntry extends RecipeSource {
  title: string;
}

export interface GovernmentRecipeRegistryEntry {
  id: string;
  title: string;
  countries: string[];
  sources: string[];
  supportedVenues: Venue[];
  readiness: RecipeReadiness;
  evidenceCount: number;
  lastSuccessfulRunAt: string;
  knownFailureModes: string[];
  promptVersion: string;
}

export const COUNTRY_REGISTRY: CountryRegistryEntry[] = [
  { id: "CN", name: "China", region: "APAC", locales: ["zh-CN"] },
  { id: "JP", name: "Japan", region: "APAC", locales: ["ja-JP", "en"] },
  { id: "DE", name: "Germany", region: "EU", locales: ["de-DE", "en"] },
  { id: "FR", name: "France", region: "EU", locales: ["fr-FR", "en"] },
  { id: "IT", name: "Italy", region: "EU", locales: ["it-IT", "en"] },
  { id: "EU", name: "European Union", region: "EU", locales: ["en"] },
  { id: "US", name: "United States", region: "NA", locales: ["en"] },
  { id: "GLOBAL", name: "Global", region: "GLOBAL", locales: ["en"] },
];

export const SOURCE_REGISTRY: SourceRegistryEntry[] = [
  {
    id: "ndrc",
    title: "NDRC policy releases",
    name: "National Development and Reform Commission",
    url: "https://www.ndrc.gov.cn/xxgk/zcfb/",
    country: "CN",
    locale: "zh-CN",
    kind: "official",
    status: "healthy",
    cadence: "intra-day",
  },
  {
    id: "mofcom",
    title: "MOFCOM policy bulletins",
    name: "Ministry of Commerce",
    url: "https://www.mofcom.gov.cn/article/zcfb/",
    country: "CN",
    locale: "zh-CN",
    kind: "official",
    status: "healthy",
    cadence: "daily",
  },
  {
    id: "miit",
    title: "MIIT regulations",
    name: "Ministry of Industry and Information Technology",
    url: "https://www.miit.gov.cn/jgsj/zcwj/index.html",
    country: "CN",
    locale: "zh-CN",
    kind: "official",
    status: "fragile",
    cadence: "daily",
  },
  {
    id: "boj",
    title: "Bank of Japan policy",
    name: "Bank of Japan",
    url: "https://www.boj.or.jp/en/mopo/index.htm/",
    country: "JP",
    locale: "ja-JP",
    kind: "official",
    status: "healthy",
    cadence: "event-driven",
  },
  {
    id: "boj-archive",
    title: "BOJ archive",
    name: "BOJ Release Archive",
    url: "https://www.boj.or.jp/en/announcements/release_2026/index.htm/",
    country: "JP",
    locale: "ja-JP",
    kind: "archive",
    status: "healthy",
    cadence: "event-driven",
  },
  {
    id: "bmwk",
    title: "German ministry press",
    name: "German Federal Ministry for Economic Affairs and Climate Action",
    url: "https://www.bmwk.de/Redaktion/DE/Pressemitteilungen/",
    country: "DE",
    locale: "de-DE",
    kind: "official",
    status: "fragile",
    cadence: "daily",
  },
  {
    id: "ec-energy",
    title: "EU commission energy news",
    name: "European Commission Energy",
    url: "https://energy.ec.europa.eu/news_en",
    country: "EU",
    locale: "en",
    kind: "official",
    status: "healthy",
    cadence: "daily",
  },
  {
    id: "fr-energy",
    title: "French ministry energy press",
    name: "French Ministry for Ecological Transition",
    url: "https://www.ecologie.gouv.fr/presse",
    country: "FR",
    locale: "fr-FR",
    kind: "official",
    status: "fragile",
    cadence: "daily",
  },
  {
    id: "cme-fedwatch",
    title: "CME FedWatch tool",
    name: "CME FedWatch",
    url: "https://www.cmegroup.com/markets/interest-rates/cme-fedwatch-tool.html",
    country: "US",
    locale: "en",
    kind: "watchlist",
    status: "healthy",
    cadence: "event-driven",
  },
  {
    id: "sec-edgar",
    title: "SEC Edgar",
    name: "SEC Edgar Search",
    url: "https://www.sec.gov/edgar/search/",
    country: "US",
    locale: "en",
    kind: "official",
    status: "healthy",
    cadence: "event-driven",
  },
  {
    id: "polymarket-meta",
    title: "Polymarket metadata",
    name: "Polymarket Market Metadata",
    url: "https://polymarket.com/",
    country: "GLOBAL",
    locale: "en",
    kind: "market",
    status: "healthy",
    cadence: "intra-day",
  },
];

function nowIso(offsetMinutes = 0): string {
  return new Date(Date.now() + offsetMinutes * 60_000).toISOString();
}

const sourceById = new Map(SOURCE_REGISTRY.map((source) => [source.id, source]));

export const GOVERNMENT_RECIPE_REGISTRY: GovernmentRecipeRegistryEntry[] = [
  {
    id: "cn-policy-lag",
    title: "Mandarin Policy Lag",
    countries: ["CN"],
    sources: ["ndrc", "mofcom", "miit"],
    supportedVenues: ["ibkr", "polymarket"],
    readiness: "live-ready",
    evidenceCount: 18,
    lastSuccessfulRunAt: nowIso(-43),
    knownFailureModes: [
      "Consent or security redirects on deep links.",
      "Circular archive pages that require homepage traversal.",
    ],
    promptVersion: "govt-cn-v3",
  },
  {
    id: "jp-translation-drift",
    title: "BOJ Translation Drift",
    countries: ["JP"],
    sources: ["boj", "boj-archive"],
    supportedVenues: ["ibkr"],
    readiness: "paper-only",
    evidenceCount: 11,
    lastSuccessfulRunAt: nowIso(-118),
    knownFailureModes: [
      "PDF render timing causing incomplete extractions.",
      "Archive releases repeating prior language with no tradable delta.",
    ],
    promptVersion: "govt-jp-v2",
  },
  {
    id: "eu-energy-watch",
    title: "EU Energy Ministry Relay",
    countries: ["DE", "FR", "IT"],
    sources: ["bmwk", "ec-energy", "fr-energy"],
    supportedVenues: ["ibkr"],
    readiness: "research-only",
    evidenceCount: 4,
    lastSuccessfulRunAt: nowIso(-325),
    knownFailureModes: [
      "Localized HTML variations breaking parser reuse.",
      "Small or stale updates that look market-moving but are not.",
    ],
    promptVersion: "govt-eu-v1",
  },
];

export function getCountryRegistry(): CountryRegistryEntry[] {
  return COUNTRY_REGISTRY;
}

export function getSourceRegistry(countries?: string[]): SourceRegistryEntry[] {
  if (!countries?.length) {
    return SOURCE_REGISTRY;
  }
  const selected = new Set(countries);
  return SOURCE_REGISTRY.filter((source) => selected.has(source.country));
}

export function getGovernmentRecipeRegistry(): GovernmentRecipeRegistryEntry[] {
  return GOVERNMENT_RECIPE_REGISTRY;
}

export function getRecipeSources(sourceIds: string[]): RecipeSource[] {
  return sourceIds
    .map((id) => sourceById.get(id))
    .filter((source): source is SourceRegistryEntry => Boolean(source))
    .map((source) => ({
      id: source.id,
      name: source.name,
      url: source.url,
      country: source.country,
      locale: source.locale,
      kind: source.kind,
      status: source.status,
      cadence: source.cadence,
    }));
}
