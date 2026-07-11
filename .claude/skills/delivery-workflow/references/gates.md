# Gates & build commands

The host has **no `node`/`npm`** — only Docker. Every JS command runs inside a
`node:22` container with the repo mounted. Use this wrapper (the `--user` mapping
keeps generated files owned by the user, not root):

```bash
docker run --rm --user "$(id -u):$(id -g)" \
  -e HOME=/tmp -e npm_config_cache=/tmp/.npm -e DATABASE_URL=local.db \
  -v "$PWD":/app -w /app node:22 bash -lc '<command>'
```

Substitute `<command>`:

| `<command>`              | Purpose                                                               |
| ------------------------ | --------------------------------------------------------------------- |
| `npm run check`          | svelte-check typecheck — **the primary gate**                         |
| `npm run lint`           | prettier check + eslint                                               |
| `npm run format`         | auto-fix formatting (run before finishing)                            |
| `npm run test`           | vitest, once. Single test: `npm run test -- --run <file> -t "<name>"` |
| `npm run build`          | production build (adapter-node → `build/`)                            |
| `npm run db:generate`    | generate a Drizzle migration after editing `schema.ts`                |
| `npm ci` / `npm install` | after changing `package.json`                                         |

Running the dev server or a booted build from a one-shot container needs a port
map (`-p 3000:3000`) and, for the dev server, `-- --host 0.0.0.0`.

Gate order for validation: `check` (primary) → `lint` → `test` → `build` (only
when the build surface changed). Run `format` before reporting done.
