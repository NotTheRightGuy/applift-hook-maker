# React Query Hook Builder

A powerful VS Code extension designed to streamline your React Query development workflow. It automates the generation of type-safe hooks, API functions, query keys, and TypeScript references directly from OpenAPI specifications or manual inputs.

## Features

### 🚀 OpenAPI / Swagger Support
- **Import from URL or JSON**: Easily load your API specification by providing a URL or pasting the JSON content directly.
- **Batch Generation**: Select multiple API endpoints at once to generate hooks in bulk.
- **Smart Detection**:
  - Automatically maps `GET` requests to `useQuery`.
  - Maps `POST`, `PUT`, `DELETE` to `useMutation`.
  - **Pagination Support**: Detects paginated responses (e.g., fields like `totalRecords`) and generates `useInfiniteQuery` with mostly complete `getNextPageParam` logic.
- **Type Generation**: Generates comprehensive TypeScript interfaces for:
  - **Request Variables**: Parameters (path/query) and request bodies.
  - **Response Models**: Strongly typed response objects, handling deeply nested structures and extracting cleaner names (e.g., `UserData` vs generic `Response`).

### 🛠️ Manual Hook Generation
- **Generate Hook from Specs**: Don't have an OpenAPI spec? No problem.
  - Interactively provide the Feature Name, API URL, and HTTP Method.
  - Paste an example JSON response to automatically infer and generate TypeScript interfaces.

### 📦 Modular Code Generation
The extension generates four distinct parts for each hook, which can be placed in separate files or combined as needed:
1.  **Models/Types**: TypeScript interfaces for the API response and variables.
2.  **API Function**: An `axios`-based async function to make the network request.
3.  **Query Keys**: A standardized factory object for React Query keys (supporting easy invalidation and scoping).
4.  **Hook**: The custom React hook (`useUser`, `useCreateUser`, etc.) wrapping the React Query logic.

### ⚡ Developer Experience
- **Append to Files**: Seamlessly append generated code to existing standard files (e.g., adding a new type to `types.ts` or a new hook to `useHooks.ts`).
- **History Support**: Remembers your recently used OpenAPI URLs for quick access.
- **Formatting**: Automatically formats generated code using a built-in Prettier implementation to match standard style guides.

## Usage

### Method 1: Generate from OpenAPI (Recommended)
1.  Open the Command Palette (`Cmd+Shift+P` or `Ctrl+Shift+P`).
2.  Run **"React Query Hook Builder: Generate Hook from OpenAPI Spec"**.
3.  **Source**: Select "Enter new OpenAPI Spec URL or JSON content" (or pick from history).
4.  **Select Endpoints**: Choose one or more operations from the list.
5.  **Destination**: For each component (Models, API, Keys, Hooks), choose to:
    - Select an existing file to append to.
    - Create a new file.
    - (The extension will remember your last used file for faster re-runs).

### Method 2: Generate from Manual Specs
1.  Open the Command Palette.
2.  Run **"React Query Hook Builder: Generate Hook from specs"**.
3.  Follow the prompts:
    - **Feature Name**: e.g., `TodoList`.
    - **Method**: `GET`, `POST`, etc.
    - **API URL**: e.g., `/api/todos`.
    - **Example Response**: Paste a JSON sample from your backend to generate types.

## Requirements
- VS Code `^1.90.0`
- A project using `react-query` (TanStack Query) and `axios`. generated code assumes standard `axios` and `react-query` imports.

## Extension Settings
This extension currently does not contribute any global settings. It relies on interaction during generation to determine file paths.

## Known Issues
- The extension assumes a standard response wrapper pattern (e.g. `{ data: T, success: boolean }`) for some heuristic optimizations, but generally supports standard OpenAPI schemas.
- Automatic import resolution is currently disabled; you may need to add imports (e.g., `import { useQuery } from '@tanstack/react-query'`) to your files manually if they are not already present.

---
**Enjoy faster React Query development!**
