/** @type {import('jest').Config} */
module.exports = {
  preset: "ts-jest",
  rootDir: "src",
  testRegex: ".*\\.spec\\.ts$",
  transform: {
    "^.+\\.ts$": ["ts-jest", { tsconfig: { module: "commonjs", moduleResolution: "node" } }],
  },
};
