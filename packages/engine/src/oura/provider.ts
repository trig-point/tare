import * as oauth from "oauth4webapi";
import { z as zod } from "zod";
import type { Config } from "../config.ts";
import { OperationError } from "../operations/registry.ts";

export const requestedScopes = ["daily", "workout"];
const metadata = {
  issuer: "https://cloud.ouraring.com",
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
  try {
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
    // The library parseFloat-normalizes expires_in, so check the body as sent.
    const sent = response.clone();
    await oauth.processAuthorizationCodeResponse(metadata, client, response);
    const result = tokenResponse.safeParse(await sent.json());
    if (!result.success) throw new OperationError(400, "oura_token_invalid");
    return result.data;
  } catch {
    throw new OperationError(400, "oura_token_invalid");
  }
}
