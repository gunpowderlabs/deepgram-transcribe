# Deepgram Project Guidelines

## Build Commands
- Install dependencies: `bun install`
- Run the transcription example: `bun transcribe.js`

## Development Commands
- Lint: `bun run lint` - Runs all linting
- Format: `bun run format` - Formats code with Prettier
- Build: `bun run build` - Builds all distribution formats
- Test: `bun test` - Runs all tests
- Single test: `bun test -t "test name"` - Runs specific test

## Code Style
- **TypeScript**: Use strong typing throughout
- **Naming**: Classes (PascalCase), methods/functions (camelCase), constants (UPPER_SNAKE_CASE)
- **Documentation**: Use JSDoc comments for all public methods and classes
- **Error Handling**: Throw specific error types, use try/catch blocks appropriately
- **Imports**: Group by type (core, third-party, internal), use named exports
- **Formatting**: 2-space indentation, semicolons, single quotes
- **Structure**: Maintain modular architecture with clear separation of concerns
- **Environment**: Use dotenv for configuration, set DEEPGRAM_API_KEY for API access