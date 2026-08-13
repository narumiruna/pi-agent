# TypeScript Template

## Human workflow

Install [just](https://github.com/casey/just), then run:

```sh
just install
just run
```

Use `just` to list all available commands.

## Automation

```sh
npm run ci
```

The CI command runs Biome, Vitest, and the TypeScript build. Husky runs it before each commit.
