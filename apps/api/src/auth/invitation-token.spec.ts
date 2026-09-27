import { generateInvitationToken, hashInvitationToken } from "./jwt.service";

describe("invitation token primitives", () => {
  it("generates an opaque 256-bit token", () => {
    const token = generateInvitationToken();

    expect(Buffer.from(token, "base64url")).toHaveLength(32);
  });

  it("hashes the same token deterministically", () => {
    expect(hashInvitationToken("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("keeps distinct tokens distinct after hashing", () => {
    expect(hashInvitationToken("token-one")).not.toBe(hashInvitationToken("token-two"));
  });
});
