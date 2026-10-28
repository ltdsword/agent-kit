export function bearerToken(header: string | null): string | null {
  const match = /^Bearer ([^\s]+)$/i.exec(header ?? "");
  return match?.[1] ?? null;
}
