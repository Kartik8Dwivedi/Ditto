# Ditto frontend

The Ditto frontend is the Intelligence Map and analysis UI for exploring repositories and pull requests through the Ditto API.

## Run locally

From `frontend/`:

```bash
npm install
npm run dev
```

By default, the frontend talks to the Ditto backend at `NEXT_PUBLIC_API_URL`, falling back to `http://localhost:3001` when the variable is unset.

For backend-free frontend development, run with the typed mock fixtures instead:

```bash
NEXT_PUBLIC_DITTO_SOURCE=mock npm run dev
```

Mock mode is explicit. When the source is the API, request failures stay visible rather than silently falling back to fixtures.

## Configuration and API client

- `lib/config.ts` contains frontend deployment and hosted-demo configuration.
- `services/ditto.api.ts` is the API client and defines the API base URL, mock/API source selection, and requests used by the UI.

The browser-facing API calls use the same-origin `/api/ditto` proxy, while Server Components can reach the configured backend directly.