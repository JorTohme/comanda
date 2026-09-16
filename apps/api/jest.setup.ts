// Test-only fixture: JwtService throws if JWT_SECRET is unset (fail-closed by design).
// This wiring is explicit and visible here, not a silent fallback inside the service.
process.env.JWT_SECRET ??= "test-only-secret-do-not-use-in-production";
