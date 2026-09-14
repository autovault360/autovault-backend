import "dotenv/config";

// Explicity opt in to the non-local Neon test host from .env DATABASE_URL,
// then run the seeder as a normal file entry point.
process.env.SEED_DB_URL = process.env.SEED_DB_URL || process.env.DATABASE_URL;

await import("./seed-load-users.js");