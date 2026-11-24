# Build and deploy workflow

[`deploy.yml`](deploy.yml) builds and publishes Neon Bastion to GitHub Pages using GitHub Actions. It builds from the repository's source code; it does not deploy a locally built `dist` folder or require Docker.

## When it runs

| Trigger | Build and test | Deploy |
| --- | --- | --- |
| Push to `master` | Yes | Yes, if the build succeeds |
| Pull request targeting `master` | Yes | No |
| Manual run on `master` | Yes | Yes, if the build succeeds |
| Manual run on another branch | Yes | No |

To run it manually, open **Actions → Build and deploy → Run workflow**, select `master`, and click **Run workflow**.

## What it does

The **build** job runs on Ubuntu and:

1. Checks out the code and sets up Node.js 22 with an npm cache.
2. Runs `npm ci` to install dependencies from the lockfile.
3. Runs `npm test`.
4. Runs `npm run build -- --base=./` to type-check and build the site. Relative asset paths allow the site to work under the repository's Pages URL.
5. Uploads `dist` as a GitHub Pages artifact.

The **deploy** job runs only after a successful build on `master`, excluding pull requests. It publishes the artifact using `actions/deploy-pages` and records the site URL in the `github-pages` environment. Deployments use the `pages` concurrency group so a running deployment is not cancelled by a newer one. The deployment does not require a separate deployment branch.

## GitHub setup

1. In the repository's **Settings → Pages**, set the build and deployment source to **GitHub Actions**.
2. In **Settings → Environments → github-pages**, ensure the deployment branch rules allow `master`. If using selected branches, add a branch rule named `master`.

The workflow grants read access to repository contents for the build and grants the deploy job Pages write and OIDC token permissions. Environment protection rules, such as required reviewers, still apply.

The published site is available at [krischilds.github.io/tower-defense-2026](https://krischilds.github.io/tower-defense-2026/).

## Troubleshooting

- **Branch `master` is not allowed to deploy:** Check the `github-pages` environment's deployment branch rules. If it allows selected branches, add `master`. If it allows protected branches only, check the repository's branch protection rules.
- **Creating Pages deployment failed with 404:** Check that GitHub Pages is enabled and its source is set to **GitHub Actions**.
- **Build failed:** Open the failed workflow run in **Actions** and inspect the failing install, test, or build step. The deploy job will not run until the build succeeds.

After correcting a setting or failure, rerun the failed job or start a new workflow run on `master`.
