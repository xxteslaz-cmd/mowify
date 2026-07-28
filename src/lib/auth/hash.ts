import { hash, verify } from "@node-rs/argon2";

/**
 * Hashes a password or a PIN with argon2id.
 *
 * PINs get the same cost as passwords deliberately. Six digits is only a
 * million possibilities, so the work factor is doing more of the defensive
 * work there than it does for a password, not less.
 */
export async function hashSecret(plaintext: string): Promise<string> {
  return hash(plaintext);
}

export async function verifySecret(
  hashed: string,
  plaintext: string,
): Promise<boolean> {
  try {
    return await verify(hashed, plaintext);
  } catch {
    // A malformed or truncated hash is a failed match, not a crash that would
    // surface as a 500 on the login form.
    return false;
  }
}
