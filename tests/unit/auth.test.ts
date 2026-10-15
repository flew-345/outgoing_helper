import { describe, expect, it } from "vitest";
import { isValidCredentials } from "../../src/components/auth/auth";

describe("internal login", () => {
  it("accepts the single configured account", () => {
    expect(isValidCredentials("admin", "password123")).toBe(true);
  });

  it("rejects other usernames and passwords", () => {
    expect(isValidCredentials("Admin", "password123")).toBe(false);
    expect(isValidCredentials("admin", "password124")).toBe(false);
    expect(isValidCredentials("guest", "password123")).toBe(false);
  });
});
