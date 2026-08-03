import { describe, expect, it } from "vitest";

import { parseEnvironment } from "../env";

describe("server environment", () => {
  it("treats blank optional live values as absent in safe demo mode", () => {
    expect(
      parseEnvironment({
        SIGNAL_MODE: "demo",
        SESSION_SIGNING_SECRET: "",
        NETWORK_HASH_SECRET: "   ",
        DATABASE_URL: "",
        BLOB_READ_WRITE_TOKEN: "",
        BLOB_STORE_ID: "",
        CRON_SECRET: "",
        HF_ENDPOINT_URL: "",
        HF_ENDPOINT_TOKEN: "",
        HF_ENDPOINT_SHARED_SECRET: "",
      }),
    ).toMatchObject({
      SIGNAL_MODE: "demo",
      SESSION_SIGNING_SECRET: undefined,
      HF_ENDPOINT_URL: undefined,
    });
  });
});
