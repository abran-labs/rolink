#!/usr/bin/env bun
/**
 * Creates or updates a Roblox experience secret through Open Cloud.
 *
 *   ROBLOX_API_KEY=... ROLINK_KEY=... bun set-roblox-secret.ts \
 *     --universe 123 --name rolink_key --domain example.com [--value-env ROLINK_KEY]
 *
 * The API key needs the `secret-store` system (universe.secret:write + read).
 * Values come only from the environment; nothing secret is printed.
 */
import sodium from "libsodium-wrappers";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    universe: { type: "string" },
    name: { type: "string" },
    domain: { type: "string" },
    "value-env": { type: "string", default: "ROLINK_KEY" },
  },
});

const fail = (message: string): never => {
  console.error(message);
  process.exit(2);
};

const universe = values.universe ?? fail("--universe is required");
const name = values.name ?? fail("--name is required");
const domain = values.domain ?? fail("--domain is required");
const apiKey = process.env.ROBLOX_API_KEY ?? fail("ROBLOX_API_KEY is not set");
const secret = process.env[values["value-env"]] ?? fail(`${values["value-env"]} is not set`);

const base = `https://apis.roblox.com/cloud/v2/universes/${universe}/secrets`;
const headers = { "x-api-key": apiKey, "content-type": "application/json" };

const keyResponse = await fetch(`${base}/public-key`, { headers });
if (!keyResponse.ok) fail(`public key request failed: ${keyResponse.status} ${await keyResponse.text()}`);
const publicKey = (await keyResponse.json()) as { secret: string; key_id: string };

await sodium.ready;
const sealed = sodium.crypto_box_seal(
  sodium.from_string(secret),
  sodium.from_base64(publicKey.secret, sodium.base64_variants.ORIGINAL),
);
const body = { secret: sodium.to_base64(sealed, sodium.base64_variants.ORIGINAL), key_id: publicKey.key_id, domain };

const update = await fetch(`${base}/${name}`, { method: "PATCH", headers, body: JSON.stringify(body) });
if (update.ok) {
  console.log(`updated secret ${name} for universe ${universe}`);
  process.exit(0);
}
if (update.status !== 404) fail(`update failed: ${update.status} ${await update.text()}`);

const create = await fetch(base, { method: "POST", headers, body: JSON.stringify({ id: name, ...body }) });
if (!create.ok) fail(`create failed: ${create.status} ${await create.text()}`);
console.log(`created secret ${name} for universe ${universe}`);
