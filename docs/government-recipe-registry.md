# Government recipe and country/source registry

`tinyfish-remora` now keeps government scan metadata in canonical registries so adding countries and sources is a data task.

## Registry models

Implemented in `src/lib/demo/registry.ts`:

- `GovernmentRecipeRegistryEntry`
  - `id`
  - `title`
  - `countries`
  - `sources`
  - `supportedVenues`
  - `readiness` (`live-ready` | `paper-only` | `research-only`)
  - `evidenceCount`
  - `lastSuccessfulRunAt`
  - `knownFailureModes`
  - `promptVersion`
- `CountryRegistryEntry`
  - `id`, `name`, `region`, `locales`
- `SourceRegistryEntry`
  - Full source metadata used by recipes (`id`, `name`, `url`, `country`, `locale`, `kind`, `status`, `cadence`) plus `title`

## Audited recipe classifications

Government scans are explicitly classified as:

- `cn-policy-lag`: `live-ready`
- `jp-translation-drift`: `paper-only`
- `eu-energy-watch`: `research-only`

## How to add a new country/source

1. Add the country to `COUNTRY_REGISTRY`.
2. Add one or more sources in `SOURCE_REGISTRY` with `country` set to that country id.
3. Add or update recipe metadata in `GOVERNMENT_RECIPE_REGISTRY` with source ids and country ids.

No UI-only selector changes are required for API consumers that rely on:

- `GET /api/demo/recipes`
- `GET /api/demo/country-sources?countries=<CSV>`

## RunRequest compatibility

`RunRequest` remains unchanged. Recipe ids, `countries`, and `sources` still flow through the existing run normalization path (`resolveRunRequest`) and runtime timeline builders.
