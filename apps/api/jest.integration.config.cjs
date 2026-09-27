/** @type {import('jest').Config} */
module.exports = {
  rootDir: ".",
  testMatch: ["<rootDir>/test/**/*.integration.spec.ts"],
  testEnvironment: "node",
  testTimeout: 30_000,
  setupFiles: ["<rootDir>/jest.setup.ts"],
  transform: {
    "^.+\\.ts$": ["ts-jest", { tsconfig: { rootDir: ".", module: "commonjs" } }],
  },
};
