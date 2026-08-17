import type { CatalogProvider, ModelsDevEntry } from "./modelsDev";

/**
 * Metadata-only fallback. CommandCode owns the authoritative model list and
 * exposes it through /provider/v1/models, so this snapshot intentionally does
 * not duplicate a stale provider catalog.
 */
export const HARDCODED_CATALOG: {
    models: Record<string, ModelsDevEntry>;
    providers: Record<string, CatalogProvider>;
} = {
    models: {},
    providers: {},
};
