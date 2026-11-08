import { z } from "zod";
import { api } from "./api.ts";

const accountSchema = z.object({
  id: z.number(),
  username: z.string(),
  timezone: z.string(),
  day_start_hour: z.number(),
  is_admin: z.boolean(),
});
export type Account = z.infer<typeof accountSchema>;
const accountBody = z.object({ user: accountSchema });
const mappingSchema = z.object({
  id: z.number(),
  user_id: z.number(),
  client_id: z.string(),
  name: z.string(),
  last_used_at: z.string().nullable(),
});
export type Mapping = z.infer<typeof mappingSchema>;

export const accountKey = (person: number) => ["account", person] as const;
export const mappingsKey = (person: number) =>
  ["account", person, "agent-tokens"] as const;

export async function readAccount(signal: AbortSignal) {
  return accountBody.parse(await api("/api/me", { signal })).user;
}
export async function saveDaySettings(timezone: string, dayStartHour: string) {
  return accountBody.parse(
    await api("/api/me", {
      method: "PATCH",
      body: JSON.stringify({
        timezone,
        day_start_hour: Number(dayStartHour),
      }),
    }),
  ).user;
}
export async function readMappings(signal: AbortSignal) {
  return z
    .object({ agent_tokens: z.array(mappingSchema) })
    .parse(await api("/api/agent-tokens", { signal })).agent_tokens;
}
export async function removeMapping(id: number) {
  await api(`/api/agent-tokens/${id}`, { method: "DELETE" });
}
export async function mapClientId(values: {
  client_id: string;
  user_id: string;
  name: string;
}) {
  return z.object({ agent_token: mappingSchema }).parse(
    await api("/api/agent-tokens", {
      method: "POST",
      body: JSON.stringify({ ...values, user_id: Number(values.user_id) }),
    }),
  ).agent_token;
}
export async function addUser(
  values:
    | { username: string; email: string }
    | { username: string; password: string },
) {
  return accountBody.parse(
    await api("/api/users", { method: "POST", body: JSON.stringify(values) }),
  ).user;
}
export function timezones(current: string) {
  const known = Intl.supportedValuesOf("timeZone");
  return known.includes(current) ? known : [current, ...known];
}
