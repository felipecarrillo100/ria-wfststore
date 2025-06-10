module.exports = {
    setupFiles: ["jest-canvas-mock"],
    testEnvironment: 'jsdom',
    transformIgnorePatterns: [
        "node_modules/(?!(@luciad)/)"
    ],
    setupFilesAfterEnv: ['./jest.setup.js'],
}
