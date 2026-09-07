/**
 * Hermetic child: XR_SECRETS_ENV_COMPAT=0 at module load.
 * Prints one JSON line: compat, env, stored, broker.
 */
import { setSecret, getSecret } from "../../../src/security/secrets.ts";
import { secretBrokerSync, envSecretCompatEnabled } from "../../../src/security/secret-broker.ts";

const name = "OPENAI_API_KEY";
delete process.env[name];
setSecret(name, "sk-phase8-not-in-env");
console.log(
  JSON.stringify({
    compat: envSecretCompatEnabled(),
    env: process.env[name],
    stored: getSecret(name),
    broker: secretBrokerSync(name),
  }),
);
