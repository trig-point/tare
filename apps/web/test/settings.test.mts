import assert from "node:assert/strict";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  assertionHeader,
  signAccessToken,
} from "../../../packages/engine/test/auth-support.ts";
import { twoUsers } from "../../../packages/engine/test/support/two-users.ts";
import {
  accountKey,
  addUser,
  mapClientId,
  readAccount,
  readMappings,
  removeMapping,
  saveDaySettings,
  timezones,
} from "../src/settings-api.ts";
import { test } from "./support.mts";
import "./tsx.mts";

const { AccountSettings, DayBoundaryForm, MappingList } = await import(
  "../src/settings.tsx"
);
const signal = new AbortController().signal;
const render = (
  node: ReactElement,
  data: [readonly unknown[], unknown][] = [],
) => {
  const client = new QueryClient();
  for (const [key, value] of data) client.setQueryData(key, value);
  return renderToStaticMarkup(
    createElement(QueryClientProvider, { client }, node),
  );
};
type Setup = Awaited<ReturnType<typeof twoUsers>>;
const actAs = (
  context: Parameters<typeof twoUsers>[0],
  person: Setup["admin"],
) => context.mock.method(globalThis, "fetch", person.request);

test("day settings form saves timezone and day start", async (context) => {
  const { admin } = await twoUsers(context, "fallback");
  actAs(context, admin);
  const saved = await saveDaySettings("America/New_York", "6");
  assert.deepEqual(await readAccount(signal), saved);
  assert.deepEqual(saved, {
    ...admin.user,
    timezone: "America/New_York",
    day_start_hour: 6,
  });
  const form = render(
    createElement(DayBoundaryForm, { account: saved, online: true }),
  );
  assert.match(form, /<option value="America\/New_York" selected="">/);
  assert.match(form, /<option value="6" selected="">06:00/);
});

test("mappings list, remove and admin map a Client ID", async (context) => {
  const setup = await twoUsers(context, "access");
  actAs(context, setup.admin);
  const values = {
    client_id: "Invented-Agent",
    user_id: String(setup.member.user.id),
    name: "Agent B",
  };
  const mapping = await mapClientId(values);
  actAs(context, setup.member);
  await assert.rejects(mapClientId({ ...values, client_id: "Other" }), {
    status: 403,
  });
  setup.setNow("2026-01-01T00:00:10.000Z");
  const agent = assertionHeader(
    await signAccessToken({ sub: "", common_name: "Invented-Agent" }),
  );
  assert.equal(
    (await setup.app.request("/api/me", { headers: agent })).status,
    200,
  );
  const listed = await readMappings(signal);
  assert.deepEqual(listed, [
    { ...mapping, last_used_at: "2026-01-01T00:00:10.000Z" },
  ]);
  const html = render(
    createElement(MappingList, {
      person: 2,
      timezone: "UTC",
      mappings: listed,
      online: true,
    }),
  );
  assert.match(
    html,
    /Agent B.*Last used <time dateTime="2026-01-01T00:00:10.000Z">/,
  );
  assert.doesNotMatch(html, /Invented-Agent/);
  await removeMapping(mapping.id);
  assert.deepEqual(await readMappings(signal), []);
  const refused = await setup.app.request("/api/me", { headers: agent });
  assert.equal(refused.status, 403);
  assert.equal((await refused.json()).error.code, "unknown_agent");
});

test("admin adds a user by Access email or by password", async (context) => {
  for (const mode of ["access", "fallback"] as const) {
    const setup = await twoUsers(context, mode);
    actAs(context, setup.member);
    const person = {
      username: `example-${mode}`,
      email: "new@example.com",
      password: "invented-new-password",
    };
    await assert.rejects(addUser(person), { status: 403 });
    actAs(context, setup.admin);
    const added = await addUser(
      mode === "access"
        ? { username: person.username, email: person.email }
        : { username: person.username, password: person.password },
    );
    const signedIn =
      mode === "access"
        ? await setup.app.request("/api/session", {
            headers: assertionHeader(
              await signAccessToken({ email: person.email }),
            ),
          })
        : await setup.signIn(person);
    assert.equal(signedIn.status, 200);
    assert.deepEqual((await signedIn.json()).user, added);
  }
});

test("mapping screens hide in fallback mode and admin forms hide for members", () => {
  const account = {
    id: 2,
    username: "example-member",
    timezone: "UTC",
    day_start_hour: 4,
    is_admin: false,
  };
  const screen = (mode: "access" | "fallback", is_admin: boolean) =>
    render(
      createElement(AccountSettings, {
        session:
          mode === "access"
            ? { mode, user: account, logout_url: "https://example.com/logout" }
            : { mode, user: account },
        online: false,
      }),
      [[accountKey(2), { ...account, is_admin }]],
    );
  const accessAdmin = screen("access", true);
  assert.match(accessAdmin, /Day boundary.*Agents.*Map a Client ID/s);
  assert.doesNotMatch(accessAdmin, /Add a person/);
  const fallbackAdmin = screen("fallback", true);
  assert.match(fallbackAdmin, /Day boundary/);
  assert.doesNotMatch(fallbackAdmin, /Agents|Map a Client ID|Add a person/);
  assert.doesNotMatch(screen("access", false), /Add a person|Map a Client ID/);
});

test("timezone choices always include UTC once", () => {
  const choices = timezones("America/New_York");
  assert.ok(choices.includes("UTC"));
  assert.equal(new Set(choices).size, choices.length);
});
