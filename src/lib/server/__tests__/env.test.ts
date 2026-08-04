import { describe, expect, it } from "vitest";

import {
  EnvironmentConfigurationError,
  parseCleanupEnvironment,
  parseEnvironment,
} from "../env";

const liveEnvironment = {
  SIGNAL_MODE: "live",
  NEXT_PUBLIC_SIGNAL_MODE: "live",
  SESSION_SIGNING_SECRET: "s".repeat(32),
  NETWORK_HASH_SECRET: "n".repeat(32),
  DATABASE_URL: "postgresql://signal.example/database",
  BLOB_READ_WRITE_TOKEN: "blob-read-write-token",
  CRON_SECRET: "c".repeat(32),
  HF_ENDPOINT_URL:
    "https://signal-enhancer.eu-west-1.aws.endpoints.huggingface.cloud/",
  HF_ENDPOINT_TOKEN: "hf_endpoint_token",
  HF_ENDPOINT_SHARED_SECRET: "h".repeat(32),
  HF_ENDPOINT_BUILD_REVISION: "a".repeat(40),
  VERCEL_GIT_COMMIT_SHA: "a".repeat(40),
  NEXT_PUBLIC_APP_URL: "https://signal.example",
} satisfies Record<string, string>;

function captureConfigurationError(values: Record<string, string | undefined>) {
  try {
    parseEnvironment(values);
  } catch (error) {
    expect(error).toBeInstanceOf(EnvironmentConfigurationError);
    return error as EnvironmentConfigurationError;
  }
  throw new Error("Expected environment validation to fail.");
}

describe("server environment", () => {
  it("treats blank optional live values as absent in safe demo mode", () => {
    expect(
      parseEnvironment({
        SIGNAL_MODE: "demo",
        NEXT_PUBLIC_SIGNAL_MODE: "demo",
        SESSION_SIGNING_SECRET: "",
        NETWORK_HASH_SECRET: "   ",
        DATABASE_URL: "",
        BLOB_READ_WRITE_TOKEN: "",
        BLOB_STORE_ID: "",
        VERCEL_OIDC_TOKEN: "",
        CRON_SECRET: "",
        HF_ENDPOINT_URL: "",
        HF_ENDPOINT_TOKEN: "",
        HF_ENDPOINT_SHARED_SECRET: "",
        HF_ENDPOINT_BUILD_REVISION: "",
      }),
    ).toMatchObject({
      SIGNAL_MODE: "demo",
      NEXT_PUBLIC_SIGNAL_MODE: "demo",
      SESSION_SIGNING_SECRET: undefined,
      HF_ENDPOINT_URL: undefined,
      HF_ENDPOINT_BUILD_REVISION: undefined,
    });
  });

  it("accepts complete cleanup infrastructure independently of demo mode", () => {
    expect(
      parseCleanupEnvironment({
        SIGNAL_MODE: "demo",
        DATABASE_URL: liveEnvironment.DATABASE_URL,
        BLOB_READ_WRITE_TOKEN: liveEnvironment.BLOB_READ_WRITE_TOKEN,
        CRON_SECRET: liveEnvironment.CRON_SECRET,
      }),
    ).toMatchObject({
      DATABASE_URL: liveEnvironment.DATABASE_URL,
      BLOB_READ_WRITE_TOKEN: liveEnvironment.BLOB_READ_WRITE_TOKEN,
      CRON_SECRET: liveEnvironment.CRON_SECRET,
    });
  });

  it("rejects partial cleanup infrastructure instead of silently skipping retention", () => {
    expect(() =>
      parseCleanupEnvironment({
        DATABASE_URL: liveEnvironment.DATABASE_URL,
        CRON_SECRET: liveEnvironment.CRON_SECRET,
      }),
    ).toThrow(EnvironmentConfigurationError);
  });

  it("normalizes an exact Hugging Face Inference Endpoint origin", () => {
    expect(parseEnvironment(liveEnvironment).HF_ENDPOINT_URL).toBe(
      "https://signal-enhancer.eu-west-1.aws.endpoints.huggingface.cloud",
    );
  });

  it("normalizes an exact canonical HTTPS application origin", () => {
    expect(
      parseEnvironment({
        ...liveEnvironment,
        NEXT_PUBLIC_APP_URL: "https://signal.example/",
      }).NEXT_PUBLIC_APP_URL,
    ).toBe("https://signal.example");
  });

  it.each([
    "http://signal.example",
    "https://signal.example/lab",
    "https://signal.example?preview=true",
    "https://user:password@signal.example",
    "https://signal.example:8443",
    " https://signal.example",
  ])("rejects a non-canonical live application origin: %s", (url) => {
    const error = captureConfigurationError({
      ...liveEnvironment,
      NEXT_PUBLIC_APP_URL: url,
    });

    expect(error.invalidVariables).toContain("NEXT_PUBLIC_APP_URL");
  });

  it.each([
    "http://signal-enhancer.eu-west-1.aws.endpoints.huggingface.cloud",
    "https://endpoints.huggingface.cloud",
    "https://signal-enhancer.eu-west-1.aws.endpoints.huggingface.cloud.evil.example",
    "https://signal-enhancer.eu-west-1.aws.endpoints.huggingface.cloud/v1",
    "https://signal-enhancer.eu-west-1.aws.endpoints.huggingface.cloud?target=evil",
    "https://user:password@signal-enhancer.eu-west-1.aws.endpoints.huggingface.cloud",
    "https://signal-enhancer.eu-west-1.aws.endpoints.huggingface.cloud:8443",
    " https://signal-enhancer.eu-west-1.aws.endpoints.huggingface.cloud",
  ])("rejects a non-endpoint base origin: %s", (HF_ENDPOINT_URL) => {
    const error = captureConfigurationError({
      ...liveEnvironment,
      HF_ENDPOINT_URL,
    });

    expect(error.invalidVariables).toContain("HF_ENDPOINT_URL");
  });

  it.each([
    ["demo", "live"],
    ["live", "demo"],
  ] as const)(
    "rejects misaligned server/public modes (%s/%s)",
    (SIGNAL_MODE, NEXT_PUBLIC_SIGNAL_MODE) => {
      const error = captureConfigurationError({
        ...liveEnvironment,
        SIGNAL_MODE,
        NEXT_PUBLIC_SIGNAL_MODE,
      });

      expect(error.invalidVariables).toEqual([
        "SIGNAL_MODE",
        "NEXT_PUBLIC_SIGNAL_MODE",
      ]);
    },
  );

  it("accepts a Blob read/write token as the legacy credential option", () => {
    expect(parseEnvironment(liveEnvironment).BLOB_READ_WRITE_TOKEN).toBe(
      "blob-read-write-token",
    );
  });

  it("accepts a store id with the ambient Vercel OIDC token as the preferred Blob credential option", () => {
    const environment = parseEnvironment({
      ...liveEnvironment,
      BLOB_READ_WRITE_TOKEN: undefined,
      VERCEL_OIDC_TOKEN: undefined,
      BLOB_STORE_ID: "private-store-id",
    });

    expect(environment.BLOB_STORE_ID).toBe("private-store-id");
    expect(environment.BLOB_READ_WRITE_TOKEN).toBeUndefined();
    expect(environment.VERCEL_OIDC_TOKEN).toBeUndefined();
  });

  it("rejects live mode when neither Blob credential option is complete", () => {
    const error = captureConfigurationError({
      ...liveEnvironment,
      BLOB_READ_WRITE_TOKEN: undefined,
      VERCEL_OIDC_TOKEN: undefined,
      BLOB_STORE_ID: undefined,
    });

    expect(error.invalidVariables).toEqual([
      "BLOB_READ_WRITE_TOKEN",
      "BLOB_STORE_ID",
    ]);
  });

  it("rejects ambiguous simultaneous Blob credential modes", () => {
    const error = captureConfigurationError({
      ...liveEnvironment,
      BLOB_STORE_ID: "private-store-id",
    });

    expect(error.invalidVariables).toEqual([
      "BLOB_READ_WRITE_TOKEN",
      "BLOB_STORE_ID",
    ]);
  });

  it.each([
    "",
    "A".repeat(40),
    "a".repeat(39),
    "a".repeat(41),
    "not-a-git-revision",
    ` ${"a".repeat(40)}`,
  ])("rejects a non-canonical worker build revision: %s", (revision) => {
    const error = captureConfigurationError({
      ...liveEnvironment,
      HF_ENDPOINT_BUILD_REVISION: revision,
    });

    expect(error.invalidVariables).toContain("HF_ENDPOINT_BUILD_REVISION");
  });

  it("requires the web and worker to serve the same full release revision", () => {
    const error = captureConfigurationError({
      ...liveEnvironment,
      HF_ENDPOINT_BUILD_REVISION: "b".repeat(40),
    });

    expect(error.invalidVariables).toEqual(
      expect.arrayContaining([
        "HF_ENDPOINT_BUILD_REVISION",
        "VERCEL_GIT_COMMIT_SHA",
      ]),
    );
  });

  it("rejects reused production credential values", () => {
    const error = captureConfigurationError({
      ...liveEnvironment,
      CRON_SECRET: liveEnvironment.SESSION_SIGNING_SECRET,
    });

    expect(error.invalidVariables).toEqual(
      expect.arrayContaining(["SESSION_SIGNING_SECRET", "CRON_SECRET"]),
    );
  });

  it.each([
    ["SESSION_SIGNING_SECRET", ` ${liveEnvironment.SESSION_SIGNING_SECRET}`],
    ["NETWORK_HASH_SECRET", ` ${liveEnvironment.NETWORK_HASH_SECRET}`],
    ["DATABASE_URL", ` ${liveEnvironment.DATABASE_URL}`],
    ["HF_ENDPOINT_TOKEN", ` ${liveEnvironment.HF_ENDPOINT_TOKEN}`],
    [
      "HF_ENDPOINT_SHARED_SECRET",
      ` ${liveEnvironment.HF_ENDPOINT_SHARED_SECRET}`,
    ],
    ["CRON_SECRET", ` ${liveEnvironment.CRON_SECRET}`],
  ])("rejects whitespace in live credential %s", (name, value) => {
    const error = captureConfigurationError({
      ...liveEnvironment,
      [name]: value,
    });

    expect(error.invalidVariables).toContain(name);
  });

  it("reports only variable names when secret validation fails", () => {
    const secretValue = "do-not-expose";
    const secretError = captureConfigurationError({
      ...liveEnvironment,
      SESSION_SIGNING_SECRET: secretValue,
    });
    const endpointError = captureConfigurationError({
      ...liveEnvironment,
      HF_ENDPOINT_URL: `${liveEnvironment.HF_ENDPOINT_URL}${secretValue}`,
    });

    expect(secretError.invalidVariables).toContain("SESSION_SIGNING_SECRET");
    expect(endpointError.invalidVariables).toContain("HF_ENDPOINT_URL");
    expect(secretError.message).not.toContain(secretValue);
    expect(endpointError.message).not.toContain(secretValue);
    expect(JSON.stringify(secretError)).not.toContain(secretValue);
    expect(JSON.stringify(endpointError)).not.toContain(secretValue);
  });
});
