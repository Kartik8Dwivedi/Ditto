# Microservice Boilerplate

A production-minded **TypeScript** + Node.js + Express + MongoDB microservice boilerplate
following a clean, layered architecture. The whole codebase is written in strict TypeScript
(compiled with `tsc`), so you get end-to-end type safety, editor autocompletion, and refactors
that fail loudly at build time instead of silently at runtime.

## Architecture

Requests flow through clearly separated layers, each with one responsibility:

```
Route → Validator (Zod) → Controller (functional) → Service (class) → Repository (class) → Model (Mongoose)
```

- **Routes** — wire HTTP verbs/paths to controllers; attach validation middleware.
- **Controllers** _(functional)_ — thin HTTP adapters: read the validated request,
  call a service, send a standardised response. No business logic, no try/catch.
- **Services** _(class)_ — framework-agnostic business logic & domain rules.
  Depend on repositories, never on Express or Mongoose directly.
- **Repositories** _(class)_ — the only layer that touches the database. A generic
  `CrudRepository` base class provides CRUD; concrete repositories extend it.
- **Models** — Mongoose schemas.

> **Why classes for service/repository and functions for controllers?**
> Services and repositories benefit from instance state and inheritance — e.g.
> `ResourceRepository extends CrudRepository` reuses CRUD, and dependency
> injection via the constructor makes them trivial to unit-test with mocks.
> Controllers are stateless request→response adapters, so plain functions keep
> them simple and tree-shakeable. This is the convention used by most mature
> Node back ends.

## Coding standards & conventions

These are the conventions every service built from this boilerplate is expected to follow. They
already exist in the code — read the `resource.*` files as the reference implementation.

**Language & type safety.** The project is **TypeScript in `strict` mode** (see `tsconfig.json`).
Prefer precise types over `any`; let the compiler prove things instead of casting. Type safety is
threaded through every layer: the model owns an interface (`IResource`), the repository/service base
classes are **generic** over it (`CrudRepository<TDoc>`, `CrudService<TDoc, TRepository>`), and
request DTOs are **inferred from the Zod schemas** (`z.infer`) rather than re-declared. `override` is
required when a subclass overrides a base method (`noImplicitOverride`), and `import type` is required
for type-only imports (`verbatimModuleSyntax`).

**Module system.** ESM everywhere (`"type": "module"`, `module: NodeNext`); relative imports must
include the `.js` extension **even in `.ts` files** (`import ResourceService from './resource.service.js';`)
— this is how NodeNext resolves the compiled output. No CommonJS (`require` / `module.exports`).

**Class-based where it pays off, functional where it's simpler.** This is the core standard:

- **Services & Repositories are classes.** Each concrete class `extends` a generic base
  (`CrudService` / `CrudRepository`) to inherit CRUD for free, receives its dependencies through
  **constructor dependency injection with a default** (real dependency in app code, mock in tests),
  and **overrides only the methods that need custom rules** — calling `super` where appropriate.
  For example, `ResourceService.create` enforces a unique name, then calls `super.create`. The
  base classes are abstract-guarded via `new.target`, so instantiating them directly throws.
- **Controllers are plain functions.** Each handler is a small, stateless async function that does
  HTTP-only work: read the already-validated request → call a service → reply via `sendSuccess(...)`.
  No business logic, and **no `try/catch`** — `asyncHandler` forwards rejections to the central
  error handler.
- **Every bit serves one use case.** Each layer has exactly one responsibility: the **Repository**
  is the only layer that touches Mongoose, **Services** hold framework-agnostic business rules
  (never see `req`/`res`), and **Controllers** deal only with HTTP.

**Naming conventions.**

- Folders are `PascalCase` (`Services/`, `Repository/`).
- Layer files are `entity.layer.ts` — lowercase, dot-delimited (`resource.service.ts`,
  `crud.repository.ts`), _even when the class inside is PascalCase_.
- Files whose main export is a class use `PascalCase` matching the class (`ApiResponse.ts`,
  `AppError.ts`, `AppConfig.ts`).
- Classes/types/interfaces are `PascalCase` (interfaces are named `I<Entity>`, e.g. `IResource`),
  functions are `camelCase`, and Zod schemas are suffixed `Schema` (`createResourceSchema`).

**Exports & barrels.** Each file uses `export default`; every folder has a barrel `index.ts` that
re-exports its members as **named** exports (`export { default as ResourceService } from './resource.service.js';`),
using `export type { … }` for type-only re-exports. Controllers are the exception — they are
re-exported as a namespace (`export * as ResourceController from './resource.controller.js';`). When
you add an entity, add it to the relevant barrels.

**Error handling.** Services and repositories **throw** typed errors from the `AppError` hierarchy
(`NotFoundError`, `ConflictError`, `ValidationError`, …) rather than returning `null`. Controllers
never `try/catch`; a central `errorHandler` normalises framework/Mongoose errors (`CastError` →
400, Mongoose `ValidationError` → 422, duplicate key → 409, …) and shapes the
`{ success: false, message, details? }` response — the stack is included only outside production.

**Responses.** Success responses always use the standard envelope via `ApiResponse` /
`sendSuccess`, and HTTP status codes always come from `http-status-codes` (`StatusCodes.CREATED`),
never magic numbers.

**Config.** Environment variables are parsed and validated once at startup with Zod (fail-fast) and
exposed through a frozen `AppConfig` object — nothing reads `process.env` directly.

**Documentation.** Public classes and methods carry JSDoc, and each layer file opens with a header
comment stating its responsibility and its "copy me, rename, adapt" intent.

## Project structure

```
tsconfig.json              # Strict TypeScript config (NodeNext, outDir ./dist)
src/                        # TypeScript source (compiled to ./dist)
├── app.ts                 # Express app factory (no listen — testable)
├── index.ts               # Bootstrap: DB connect, listen, graceful shutdown
├── Config/                # Env validation, DB, logger, rate limiter
├── Controllers/           # Functional request handlers
├── Middlewares/           # asyncHandler, validate, errorHandler, notFound
├── Models/                # Mongoose schemas + document interfaces
├── Repository/            # Generic CrudRepository<T> (base) + concrete repositories
├── Services/              # Business logic — generic CrudService<T> (classes)
├── Routes/                # /api → /v1 → feature routers
├── Utils/                 # AppError hierarchy, ApiResponse
└── Validators/            # Zod request schemas (+ inferred DTO types)
```

## Getting started

```bash
npm install
cp .sample.env .env       # then edit values
npm run dev               # tsx watch — runs TypeScript directly with hot reload
npm run build             # type-check + compile to ./dist
npm start                 # run the compiled app (node dist/index.js)
```

## Scripts

| Script                 | Description                                      |
| ---------------------- | ------------------------------------------------ |
| `npm run dev`          | Run `src/index.ts` with `tsx watch` (hot reload) |
| `npm run build`        | Compile TypeScript to `./dist` with `tsc`        |
| `npm start`            | Run the compiled server (`node dist/index.js`)   |
| `npm run typecheck`    | Type-check only, no emit (`tsc --noEmit`)        |
| `npm run lint`         | Lint with ESLint (typescript-eslint)             |
| `npm run lint:fix`     | Lint and auto-fix                                |
| `npm run format`       | Format with Prettier                             |
| `npm run format:check` | Check formatting                                 |

## Environment variables

| Variable      | Required | Default       | Description                             |
| ------------- | -------- | ------------- | --------------------------------------- |
| `NODE_ENV`    | no       | `development` | `development` \| `test` \| `production` |
| `PORT`        | no       | `3001`        | HTTP port                               |
| `MONGO_URI`   | **yes**  | —             | MongoDB connection string               |
| `CORS_ORIGIN` | no       | `*`           | Comma-separated allowed origins, or `*` |

Env vars are validated at startup (Zod) — the process exits with a clear message
if anything is missing or invalid.

## Example API (Resource)

`Resource` is a neutral placeholder entity — the copy-paste template for every new entity. See
[Adding a new entity](#adding-a-new-entity--copy-the-resource-templates) for the full workflow.

| Method   | Path                    | Description      |
| -------- | ----------------------- | ---------------- |
| `GET`    | `/health`               | Liveness probe   |
| `GET`    | `/api/v1/resources`     | List (paginated) |
| `POST`   | `/api/v1/resources`     | Create           |
| `GET`    | `/api/v1/resources/:id` | Get by id        |
| `PATCH`  | `/api/v1/resources/:id` | Update           |
| `DELETE` | `/api/v1/resources/:id` | Delete           |

### Response envelope

Success:

```json
{
  "success": true,
  "message": "Resources fetched",
  "data": [],
  "meta": { "page": 1, "limit": 20, "total": 0, "totalPages": 1 }
}
```

Error (produced centrally by the error handler):

```json
{
  "success": false,
  "message": "Request validation failed",
  "details": [{ "source": "body", "path": "name", "message": "..." }]
}
```

## Adding a new entity — copy the `resource.*` templates

The **six `resource.*` files are the canonical templates** for this codebase. To add a new entity
(a new model, its repository, service, validator, controller, and routes) you **copy each file,
rename it, and adapt it** — you never write a layer from scratch. Because the shared base classes
(`CrudRepository`, `CrudService`) already give you full CRUD, you only fill in what actually differs
for your entity.

From `microservice/src`, copy each template and rename it (example: creating a `User` entity):

```bash
cp Models/resource.model.ts           Models/user.model.ts
cp Repository/resource.repository.ts   Repository/user.repository.ts
cp Services/resource.service.ts        Services/user.service.ts
cp Validators/resource.validator.ts    Validators/user.validator.ts
cp Controllers/resource.controller.ts  Controllers/user.controller.ts
cp Routes/v1/resource.routes.ts        Routes/v1/user.routes.ts
```

Then, in each copy, replace `Resource`/`resource` with your entity name and adjust the contents:

| Copy this template                   | To                                   | Then change                                                                                               |
| ------------------------------------ | ------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| `Models/resource.model.ts`           | `Models/<entity>.model.ts`           | The `I<Entity>` interface, schema fields, indexes, `mongoose.model<I<Entity>>('<Entity>', …)`             |
| `Repository/resource.repository.ts`  | `Repository/<entity>.repository.ts`  | `extends CrudRepository<I<Entity>>`, `super(<Entity>)`, add domain queries (e.g. `findByName`)            |
| `Services/resource.service.ts`       | `Services/<entity>.service.ts`       | `extends CrudService<I<Entity>, <Entity>Repository>`, inject the repo, override methods with custom rules |
| `Validators/resource.validator.ts`   | `Validators/<entity>.validator.ts`   | Zod schemas keyed by `body` / `params` / `query`, and the inferred DTO types (`z.infer`)                  |
| `Controllers/resource.controller.ts` | `Controllers/<entity>.controller.ts` | Instantiate the new service; rename the handlers; point the DTO casts at the new inferred types           |
| `Routes/v1/resource.routes.ts`       | `Routes/v1/<entity>.routes.ts`       | Swap in the new validators + controller                                                                   |

Finally, wire it up (the easy-to-forget steps):

1. Add the new exports to each barrel — `Models/index.ts`, `Repository/index.ts`,
   `Services/index.ts`, and `Controllers/index.ts` — following the existing
   `export { default as … }` / `export type { … }` / `export * as …Controller` patterns.
2. Mount the router in `Routes/v1/index.ts`: `router.use('/<entities>', <entity>Routes);`.
3. Run `npm run typecheck` — the compiler will point out anything you missed.

## Suggested next steps

These are **not implemented yet** — the boilerplate ships without tests, Docker, CI, auth, or API
docs today. They are the recommended additions before running a service in production:

- **Testing**: Vitest/Jest + Supertest (the app factory makes this easy).
- **API docs**: OpenAPI/Swagger generated from the Zod schemas.
- **Auth**: JWT middleware + role guards.
- **Containerisation**: `Dockerfile` + `docker-compose` (app + MongoDB).
- **CI**: GitHub Actions running `lint` + `format:check` + tests.
- **Observability**: structured JSON logs (pino) + request IDs + `/metrics`.
