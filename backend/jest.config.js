module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  // jose ships ESM only, so it is compiled to CommonJS for Jest (as in the e2e config)
  transform: { '^.+\\.(t|j)s$': ['ts-jest', { isolatedModules: true, tsconfig: { allowJs: true, esModuleInterop: true, experimentalDecorators: true, emitDecoratorMetadata: true, target: 'ES2022', module: 'commonjs' } }] },
  transformIgnorePatterns: ['/node_modules/(?!jose/)'],
  testEnvironment: 'node',
  collectCoverageFrom: ['**/*.ts', '!**/*.module.ts', '!main.ts', '!worker.ts', '!database/seed/**'],
  coverageDirectory: '../coverage',
};
