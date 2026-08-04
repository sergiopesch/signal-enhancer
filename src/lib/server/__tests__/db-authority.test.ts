import { beforeEach, describe, expect, it, vi } from "vitest";

const environmentMocks = vi.hoisted(() => ({
  requireCleanupEnvironment: vi.fn(),
  requireLiveEnvironment: vi.fn(),
}));
const neonMocks = vi.hoisted(() => ({ neon: vi.fn(() => vi.fn()) }));

vi.mock("server-only", () => ({}));
vi.mock("@neondatabase/serverless", () => neonMocks);
vi.mock("../env", () => environmentMocks);

import { getCleanupDatabase, getDatabase } from "../db";

describe("database authority boundaries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    environmentMocks.requireLiveEnvironment.mockReturnValue({
      DATABASE_URL: "postgresql://live.example/database",
    });
    environmentMocks.requireCleanupEnvironment.mockReturnValue({
      DATABASE_URL: "postgresql://cleanup.example/database",
    });
  });

  it("keeps generic database access live-only", () => {
    expect(getDatabase()).toBeDefined();

    expect(environmentMocks.requireLiveEnvironment).toHaveBeenCalledOnce();
    expect(environmentMocks.requireCleanupEnvironment).not.toHaveBeenCalled();
  });

  it("exposes cleanup infrastructure through its dedicated accessor", () => {
    expect(getCleanupDatabase()).toBeDefined();

    expect(environmentMocks.requireCleanupEnvironment).toHaveBeenCalledOnce();
    expect(environmentMocks.requireLiveEnvironment).not.toHaveBeenCalled();
  });
});
