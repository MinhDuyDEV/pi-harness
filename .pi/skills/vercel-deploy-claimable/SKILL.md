---
name: vercel-deploy-claimable
description: >-
  Deploys a project to Vercel without authentication via scripts/deploy.sh — returns a live preview URL plus a
  claimable link that transfers the deployment to the user's Vercel account. User-invoked: load via
  /skill:vercel-deploy-claimable when asked to deploy to Vercel, get a preview link, or "push this live".
metadata:
  version: 1.0.0
  tags:
  - devops
  - integration
  dependencies: []
disable-model-invocation: true
---

# Vercel Deploy

## When to Use

- When the user requests deploying a project to Vercel and needs preview/claim links.

## When NOT to Use

- When deployment is not requested or targets a non-Vercel platform.


## How It Works

1. Packages your project into a tarball (excludes `node_modules` and `.git`)
2. Auto-detects framework from `package.json`
3. Uploads to deployment service
4. Returns **Preview URL** (live site) and **Claim URL** (transfer to your Vercel account)

## Usage

```bash
bash {baseDir}/scripts/deploy.sh [path]
```

**Arguments:**

- `path` - Directory to deploy, or a `.tgz` file (defaults to current directory)

**Examples:**

```bash
# Deploy current directory
bash {baseDir}/scripts/deploy.sh

# Deploy specific project
bash {baseDir}/scripts/deploy.sh /path/to/project

# Deploy existing tarball
bash {baseDir}/scripts/deploy.sh /path/to/project.tgz
```

## Output

```
Preparing deployment...
Detected framework: nextjs
Creating deployment package...
Deploying...
✓ Deployment successful!

Preview URL: https://skill-deploy-abc123.vercel.app
Claim URL:   https://vercel.com/claim-deployment?code=...
```

The script also outputs JSON to stdout for programmatic use:

```json
{
  "previewUrl": "https://skill-deploy-abc123.vercel.app",
  "claimUrl": "https://vercel.com/claim-deployment?code=...",
  "deploymentId": "dpl_...",
  "projectId": "prj_..."
}
```

## Framework Detection

The script auto-detects frameworks from `package.json`. Supported frameworks include:

- **React**: Next.js, Gatsby, Create React App, Remix, React Router
- **Vue**: Nuxt, Vitepress, Vuepress, Gridsome
- **Svelte**: SvelteKit, Svelte, Sapper
- **Other Frontend**: Astro, Solid Start, Angular, Ember, Preact, Docusaurus
- **Backend**: Express, Hono, Fastify, NestJS, Elysia, h3, Nitro
- **Build Tools**: Vite, Parcel
- **And more**: Blitz, Hydrogen, RedwoodJS, Storybook, Sanity, etc.

For static HTML projects (no `package.json`), framework is set to `null`.

## Static HTML Projects

For projects without a `package.json`:

- If there's a single `.html` file not named `index.html`, it gets renamed automatically
- This ensures the page is served at the root URL (`/`)

## Present Results to User

Always show both URLs: the Preview URL to view the live site, and the Claim URL to transfer the deployment to the user's Vercel account.

## Troubleshooting

### Network Egress Error

If deployment fails due to network restrictions, the environment must allow outbound HTTPS to `*.vercel.com` (the deploy endpoint and preview hosts). Ask the user to allowlist that domain in their sandbox or network policy, then retry the deploy.
