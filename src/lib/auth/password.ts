import "server-only";

// The implementation lives in ./hash so that standalone scripts — the org
// backfill, for one — can hash without tripping the server-only guard, which
// throws outside a bundler that understands it. Application code should keep
// importing from here, so the guard still catches an accidental client import.
export { hashSecret, verifySecret } from "./hash";
