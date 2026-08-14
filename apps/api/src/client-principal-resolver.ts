import type {
  ClientPrincipal,
  ClientPrincipalResolver,
} from "@ii-tonya/application";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

const validatedPrincipal = (value: unknown): ClientPrincipal | null => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const principal = value as Partial<ClientPrincipal>;
  return principal.authenticated === true &&
    principal.active === true &&
    typeof principal.userId === "string" &&
    UUID_PATTERN.test(principal.userId)
    ? (principal as ClientPrincipal)
    : null;
};

export async function resolveClientPrincipal(
  resolver: ClientPrincipalResolver,
  authorization: string | undefined,
): Promise<ClientPrincipal | null> {
  try {
    return validatedPrincipal(await resolver.resolve(authorization));
  } catch {
    return null;
  }
}

export const unavailableClientPrincipalResolver: ClientPrincipalResolver =
  Object.freeze({
    async resolve() {
      return null;
    },
  });
