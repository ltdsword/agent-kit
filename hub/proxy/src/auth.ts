const encoder = new TextEncoder();

export function hasValidBearer(header: string | null, expected: string | undefined): boolean {
  if (!header || !expected) return false;
  const match = /^Bearer (.*)$/i.exec(header);
  if (!match) return false;

  const actual = encoder.encode(match[1]);
  const wanted = encoder.encode(expected);
  const length = Math.max(actual.length, wanted.length);
  let difference = actual.length ^ wanted.length;

  for (let index = 0; index < length; index += 1) {
    difference |= (actual[index] ?? 0) ^ (wanted[index] ?? 0);
  }

  return difference === 0;
}
