# Repository Guide

## Layout

- `backend/`: Express, Mongoose, and TypeScript API.
- `frontend/`: Next.js 16, React 19, and Tailwind CSS 4 application.

## Backend

### ESM imports — required

`backend/package.json` sets `"type": "module"`. All relative backend imports **must use explicit `.js` extensions**, including when the source file is `.ts` (for example, `import AppConfig from './Config/AppConfig.js'`).

### Architecture

Add backend features through the established chain:

`Routes -> Validators (Zod) -> Controllers -> Services -> Repository -> Models`

- Routes register endpoints and compose validation plus `asyncHandler`.
- Validators parse, coerce, and validate request data with Zod.
- Controllers are stateless HTTP adapters: read validated input, call services, and shape responses.
- Services hold framework-independent business logic.
- Repositories are the only layer that uses Mongoose/database queries.
- Models define Mongoose schemas and document types.

Extend `Services/crud.service.ts` and `Repository/crud.repository.ts` for resource-specific services and repositories; they are abstract generic CRUD bases, not standalone implementations.

### Configuration, errors, and responses

- Only `Config/AppConfig.ts` reads `process.env`. It validates with Zod and exits at startup on invalid configuration. Add every new variable to its schema and `backend/.sample.env`.
- Use `AppError` (or its subclasses) for operational errors. Wrap async controller handlers with `asyncHandler`; do not add `try/catch` blocks in controllers.
- Send successful API responses through `ApiResponse`/`sendSuccess`. Central error middleware produces error responses.

### Commands

```bash
cd backend && npm run dev
cd backend && npm run build
cd backend && npm run typecheck
cd backend && npm run lint
cd backend && npm run format
```

## Frontend

Next.js 16 and React 19 include breaking changes that differ from older App Router examples. **Before writing any frontend code, read the relevant guide in `frontend/node_modules/next/dist/docs/`.** Do not assume Next 13/14 patterns are valid.

```bash
cd frontend && npm run dev
cd frontend && npm run build
cd frontend && npm run lint
```
