const TEST_PASSWORD = "agent-hub-spike-password";

export async function measurePasswordHash(iterations: number): Promise<number> {
  const started = performance.now();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const password = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(TEST_PASSWORD),
    "PBKDF2",
    false,
    ["deriveBits"],
  );

  await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    password,
    256,
  );

  return Number((performance.now() - started).toFixed(2));
}
