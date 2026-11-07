import { OperationError } from "../operations/registry.ts";

const statuses = {
  oura_unavailable: 503,
  oura_key_unavailable: 503,
  oura_not_connected: 404,
  oura_reconnect_required: 409,
  oura_not_configured: 503,
  oura_client_rejected: 503,
  oura_rate_limited: 503,
  oura_save_failed: 500,
} as const;
export type RefreshFailure = keyof typeof statuses;
export interface Access {
  accessToken: string;
  accessExpiresAt: string;
}
export type RefreshResult = Access | RefreshFailure;
export const refreshError = (code: RefreshFailure) =>
  new OperationError(statuses[code], code);
