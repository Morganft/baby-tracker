// Import the db module for its side effects: on server startup this opens the
// SQLite file, sets pragmas, and applies pending migrations (see
// $lib/server/db). Doing it here means a fresh container is schema-ready on
// boot, before the first request.
import '$lib/server/db';
