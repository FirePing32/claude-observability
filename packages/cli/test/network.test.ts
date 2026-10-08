import { afterEach, describe, expect, it } from "vitest";
import { agentEnv, agentPlan } from "../src/agent";
import { describeNetworkError } from "../src/api";

const fetchFailed = (code: string) => Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error("x"), { code }) });

describe("network errors", () => {
  it("explains TLS-inspection certificate failures", () => {
    const m = describeNetworkError(fetchFailed("SELF_SIGNED_CERT_IN_CHAIN"));
    expect(m).toMatch(/NODE_EXTRA_CA_CERTS/);
    expect(m).toMatch(/Netskope|Zscaler/);
  });
  it("surfaces the underlying cause instead of 'fetch failed'", () => {
    expect(describeNetworkError(fetchFailed("ENOTFOUND"))).toMatch(/doesn't resolve/);
    expect(describeNetworkError(fetchFailed("ETIMEDOUT"))).toMatch(/ETIMEDOUT/);
  });
});

describe("background agent environment", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });
  it("carries CA, proxy and config settings into the service definition", () => {
    for (const k of Object.keys(agentEnv())) delete process.env[k]; // start from a clean slate
    process.env.NODE_EXTRA_CA_CERTS = "/Users/me/.certs/corp-ca.pem";
    process.env.HTTPS_PROXY = "http://proxy.corp:8080";
    expect(agentEnv()).toEqual({ NODE_EXTRA_CA_CERTS: "/Users/me/.certs/corp-ca.pem", HTTPS_PROXY: "http://proxy.corp:8080" });
    const plan = agentPlan();
    if (plan.kind !== "schtasks") expect(plan.contents).toContain("/Users/me/.certs/corp-ca.pem");
  });
});
