import { describe, expect, it } from "vitest";
import { assertSafeAIBaseUrl, isPrivateAddress } from "../src/net-guard.js";

describe("isPrivateAddress", () => {
  it("flags loopback, private, link-local, CGNAT and metadata ranges", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.9", "172.31.255.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "::1", "fc00::1", "fd12::1", "fe80::1", "::ffff:10.0.0.5"]) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
  });

  it("allows public addresses", () => {
    for (const ip of ["8.8.8.8", "1.1.1.1", "172.32.0.1", "100.128.0.1", "2606:4700::1111"]) {
      expect(isPrivateAddress(ip), ip).toBe(false);
    }
  });
});

describe("assertSafeAIBaseUrl", () => {
  it("rejects plain HTTP endpoints", async () => {
    await expect(assertSafeAIBaseUrl("http://example.com/v1")).rejects.toThrow(/HTTPS/);
  });

  it("rejects private and metadata IP literals even over HTTPS", async () => {
    for (const target of ["https://169.254.169.254/latest/meta-data", "https://10.0.0.1/v1", "https://192.168.0.10/v1", "https://[::1]/v1", "https://127.0.0.1/v1"]) {
      await expect(assertSafeAIBaseUrl(target), target).rejects.toThrow();
    }
  });

  it("rejects URLs with embedded credentials", async () => {
    await expect(assertSafeAIBaseUrl("https://user:pass@8.8.8.8/v1")).rejects.toThrow();
  });

  it("accepts public HTTPS endpoints", async () => {
    await expect(assertSafeAIBaseUrl("https://8.8.8.8/v1")).resolves.toBeInstanceOf(URL);
  });
});
