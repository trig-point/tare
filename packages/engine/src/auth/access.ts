import { type JWTVerifyGetKey, jwtVerify } from "jose";

export type AccessIdentity =
  | { kind: "service"; commonName: string }
  | { kind: "browser"; email: string };

export function normalizeAccessEmail(raw: string): string | null {
  return raw.trim().toLowerCase() || null;
}

export function createAccessVerifier(options: {
  teamDomain: string;
  audience: string;
  keySet: JWTVerifyGetKey;
  now: () => Date;
}): (token: string) => Promise<AccessIdentity | null> {
  return async (token) => {
    try {
      const { payload } = await jwtVerify(token, options.keySet, {
        issuer: options.teamDomain,
        audience: options.audience,
        algorithms: ["RS256"],
        requiredClaims: ["exp"],
        currentDate: options.now(),
      });
      if (
        payload.sub === "" &&
        typeof payload.common_name === "string" &&
        payload.common_name !== ""
      )
        return { kind: "service", commonName: payload.common_name };
      if (typeof payload.email === "string") {
        const email = normalizeAccessEmail(payload.email);
        if (email !== null) return { kind: "browser", email };
      }
      return null;
    } catch {
      return null;
    }
  };
}
