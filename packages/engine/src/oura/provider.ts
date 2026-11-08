import * as oauth from "oauth4webapi";
import { z as zod } from "zod";
import type { Config } from "../config.ts";
import { OperationError } from "../operations/registry.ts";
import type { RefreshFailure } from "./refresh-result.ts";

export const requestedScopes = ["daily", "workout"];
const metadata = {
  issuer: "https://moi.ouraring.com/oauth/v2/ext/oauth-anonymous",
  authorization_endpoint: "https://cloud.ouraring.com/oauth/authorize",
  token_endpoint: "https://api.ouraring.com/oauth/token",
};
const tokenResponse = zod.object({
  access_token: zod.string().min(1),
  refresh_token: zod.string().min(1),
  token_type: zod.string().refine((value) => value.toLowerCase() === "bearer"),
  expires_in: zod.number().int().positive(),
  scope: zod.string().optional(),
});
export type TokenTransport = NonNullable<
  oauth.TokenEndpointRequestOptions[typeof oauth.customFetch]
>;

// Oura sends null optional fields and an unrequested id_token; oauth4webapi
// type-checks every present field and would validate a string id_token.
function standardTokenBody(response: Response, body: object) {
  const shaped: Record<string, unknown> = { ...body };
  delete shaped.id_token;
  for (const field of ["expires_in", "scope", "authorization_details"])
    if (shaped[field] === null) delete shaped[field];
  const scope = shaped.scope;
  if (Array.isArray(scope) && scope.every((item) => typeof item === "string"))
    shaped.scope = scope.join(" ");
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  const standard = new Response(JSON.stringify(shaped), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
  return { standard, shaped };
}

function valueType(value: unknown) {
  if (value === null) return "null";
  return Array.isArray(value) ? "array" : typeof value;
}

// Names and types only: values are tokens.
function logRejectedBody(body: unknown) {
  const fields =
    typeof body === "object" && body !== null && !Array.isArray(body)
      ? Object.entries(body).map(
          ([name, value]) => `${name}:${valueType(value)}`,
        )
      : [valueType(body)];
  console.error("oura_token_body_rejected", fields.join(" "));
}

async function checkedTokenBody(
  response: Response,
  process: (response: Response) => Promise<unknown>,
) {
  const received: unknown = await response
    .clone()
    .json()
    .catch(() => undefined);
  // The library parseFloat-normalizes expires_in, so check the body as sent.
  const { standard, shaped } =
    typeof received === "object" &&
    received !== null &&
    !Array.isArray(received)
      ? standardTokenBody(response, received)
      : { standard: response, shaped: received };
  try {
    await process(standard);
  } catch (error) {
    if (error instanceof oauth.OperationProcessingError)
      logRejectedBody(received);
    throw error;
  }
  const parsed = tokenResponse.safeParse(shaped);
  if (!parsed.success) logRejectedBody(received);
  return parsed;
}

export async function authorizationUrl(
  app: NonNullable<Config["oura"]>,
  state: string,
  verifier: string,
) {
  const url = new URL(metadata.authorization_endpoint);
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: app.clientId,
    redirect_uri: app.redirectUrl,
    scope: requestedScopes.join(" "),
    state,
    code_challenge: await oauth.calculatePKCECodeChallenge(verifier),
    code_challenge_method: "S256",
  }).toString();
  return url.href;
}

export async function exchangeCode(
  app: NonNullable<Config["oura"]>,
  callback: URL,
  state: string,
  verifier: string,
  signal: AbortSignal,
  transport?: TokenTransport,
) {
  const client = { client_id: app.clientId };
  const parameters = oauth.validateAuthResponse(
    metadata,
    client,
    callback,
    state,
  );
  const response = await oauth.authorizationCodeGrantRequest(
    metadata,
    client,
    oauth.ClientSecretPost(app.clientSecret),
    parameters,
    app.redirectUrl,
    verifier,
    { signal, ...(transport ? { [oauth.customFetch]: transport } : {}) },
  );
  const result = await checkedTokenBody(response, (standard) =>
    oauth.processAuthorizationCodeResponse(metadata, client, standard),
  );
  if (!result.success) throw new OperationError(400, "oura_token_invalid");
  return result.data;
}

export type RefreshGrant = zod.infer<typeof tokenResponse> & {
  expiresAt: string;
};

export async function refreshGrant(
  app: NonNullable<Config["oura"]>,
  refreshToken: string,
  dispatchedAt: Date,
  signal: AbortSignal,
  validated: (grant: RefreshGrant) => void,
  transport?: TokenTransport,
): Promise<RefreshGrant | RefreshFailure> {
  let status: number | undefined;
  try {
    const client = { client_id: app.clientId };
    const response = await oauth.refreshTokenGrantRequest(
      metadata,
      client,
      oauth.ClientSecretPost(app.clientSecret),
      refreshToken,
      { signal, ...(transport ? { [oauth.customFetch]: transport } : {}) },
    );
    status = response.status;
    if (status === 429) return "oura_rate_limited";
    if (status === 401) return "oura_client_rejected";
    if (status !== 200 && status !== 400) return "oura_unavailable";
    const parsed = await checkedTokenBody(response, (standard) =>
      oauth.processRefreshTokenResponse(metadata, client, standard),
    );
    if (!parsed.success) return "oura_unavailable";
    const expires = dispatchedAt.getTime() + parsed.data.expires_in * 1000;
    if (!Number.isFinite(expires) || Math.abs(expires) > 8.64e15)
      return "oura_unavailable";
    const grant = {
      ...parsed.data,
      expiresAt: new Date(expires).toISOString(),
    };
    validated(grant);
    return grant;
  } catch (error) {
    if (status === 400 && error instanceof oauth.ResponseBodyError) {
      if (error.error === "invalid_grant") return "oura_reconnect_required";
      if (
        [
          "invalid_client",
          "unauthorized_client",
          "unsupported_grant_type",
          "invalid_request",
          "invalid_scope",
        ].includes(error.error)
      )
        return "oura_client_rejected";
    }
    return "oura_unavailable";
  }
}
