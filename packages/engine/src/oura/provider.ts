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

// Oura sends scope as an array or null; oauth4webapi accepts only a string.
async function standardScope(response: Response) {
  const body: unknown = await response
    .clone()
    .json()
    .catch(() => undefined);
  if (typeof body !== "object" || body === null || !("scope" in body))
    return response;
  const { scope, ...rest } = body;
  const isStringList =
    Array.isArray(scope) && scope.every((item) => typeof item === "string");
  if (scope !== null && !isStringList) return response;
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  return new Response(
    JSON.stringify(isStringList ? { ...rest, scope: scope.join(" ") } : rest),
    { status: response.status, statusText: response.statusText, headers },
  );
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
  const response = await standardScope(
    await oauth.authorizationCodeGrantRequest(
      metadata,
      client,
      oauth.ClientSecretPost(app.clientSecret),
      parameters,
      app.redirectUrl,
      verifier,
      { signal, ...(transport ? { [oauth.customFetch]: transport } : {}) },
    ),
  );
  // The library parseFloat-normalizes expires_in, so check the body as sent.
  const sent = response.clone();
  await oauth.processAuthorizationCodeResponse(metadata, client, response);
  const result = tokenResponse.safeParse(await sent.json());
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
    const standard = await standardScope(response);
    const sent = standard.clone();
    await oauth.processRefreshTokenResponse(metadata, client, standard);
    const parsed = tokenResponse.safeParse(await sent.json());
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
