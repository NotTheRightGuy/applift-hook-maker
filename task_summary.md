
You requested to ask the user for an example response when the response type defaults to 'any' (specifically when OpenAPI schema is missing).

### Changes
- **Updated `src/extension.ts`**:
  - In `generateHookFromOpenAPI`, verify if `responseSchemaStr` was successfully determined.
  - If NOT determined, prompt the user: "No response schema found. Paste example JSON response?".
  - If the user agrees and pastes JSON, pass this `exampleResponse` to the generation logic.
  - This allows `generateFiles` to fallback to generating types from the example JSON instead of defaulting to `any`.
