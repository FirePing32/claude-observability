/** How long raw usage facts are kept. Sized to stay well inside a free Postgres tier (see README → Data model). */
export const RETENTION_DAYS = 60;
/** Upload log: only used for "last upload" and data-quality checks. */
export const INGEST_LOG_DAYS = 14;
