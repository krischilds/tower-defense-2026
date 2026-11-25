# GitHub Actions workflows

The repository's Actions list includes two workflows:

| Workflow | Purpose |
| --- | --- |
| [Build and deploy](https://github.com/krischilds/tower-defense-2026/actions/workflows/deploy.yml) | The repository's custom [`deploy.yml`](deploy.yml) tests and builds the game, then publishes it to GitHub Pages. |
| [pages-build-deployment](https://github.com/krischilds/tower-defense-2026/actions/workflows/pages/pages-build-deployment) | A GitHub-generated Pages workflow used for branch-based Pages publishing. It is managed by GitHub, not defined by a file in this repository. |

These are different publishing paths. This project is intended to use **GitHub Actions** as its Pages source so that the custom workflow builds the Vue/Vite application before deploying it. The generated workflow may still appear in the Actions list or run history even after changing the Pages source; its presence alone does not mean it is handling the current deployment. If Pages is configured to deploy from a branch instead, GitHub uses the branch's selected folder as the publishing source; that is not a substitute for this project's Vite build.

## Build and deploy

This workflow builds from the repository's source code; it does not deploy a locally built `dist` folder or require Docker.

## When it runs

| Trigger | Build and test | Deploy |
| --- | --- | --- |
| Push to `master` | Yes | No |
| Push to a branch beginning with `release` | Yes | Yes, if the build succeeds |
| Pull request targeting `master` or a branch beginning with `release` | Yes | No |
| Manual run on `master` | Yes | No |
| Manual run on a branch beginning with `release` | Yes | Yes, if the build succeeds |
| Manual run on another branch | Yes | No |

Release branch examples include `release`, `release-1.0`, `release/1.0`, and `release/1.0/fix`. Other branches do not trigger a push build. To run it manually, open **Actions → Build and deploy → Run workflow**, choose the branch, and click **Run workflow**. The workflow file must be present on the default branch for manual runs to be available.

## What it does

The **build** job runs on Ubuntu and:

1. Checks out the code and sets up Node.js 22 with an npm cache.
2. Runs `npm ci` to install dependencies from the lockfile.
3. Runs `npm test`.
4. Runs `npm run build -- --base=./` to type-check and build the site. Relative asset paths allow the site to work under the repository's Pages URL.
5. Uploads `dist` as a GitHub Pages artifact.

The **deploy** job runs only after a successful build on a branch beginning with `release`, excluding pull requests. It publishes the artifact using `actions/deploy-pages` and records the site URL in the `github-pages` environment. All release branches deploy to the **same site**, so a later deployment replaces the previous one. Deployments use the `pages` concurrency group so a running deployment is not cancelled by a newer one.

## `deploy.yml` line by line

The line numbers below refer to [`deploy.yml`](deploy.yml). YAML indentation groups settings under their parent; lines beginning with `-` are items in a list. Blank lines 2, 9, 12, and 28 only separate sections.

| Line | Code | Explanation |
| --- | --- | --- |
| 1 | `name: Build and deploy` | Names the workflow as it appears in the GitHub Actions interface. |
| 3 | `on:` | Begins the list of events that can start a workflow run. |
| 4 | `push:` | Enables runs for pushes to the repository. |
| 5 | `branches: [master, 'release*', 'release*/**']` | Restricts push runs to `master` and branches beginning with `release`. The second release pattern also matches branch names containing slashes. |
| 6 | `pull_request:` | Enables runs for pull request events. |
| 7 | `branches: [master, 'release*', 'release*/**']` | Restricts this trigger to pull requests **targeting** `master` or a branch beginning with `release`; it does not filter the source branch. |
| 8 | `workflow_dispatch:` | Allows someone with appropriate access to start the workflow manually from GitHub Actions and choose a branch. |
| 10 | `permissions:` | Starts the workflow-level permissions for the automatically provided `GITHUB_TOKEN`. |
| 11 | `contents: read` | Allows the workflow token to read repository contents, including the code checked out by the build. |
| 13 | `jobs:` | Begins the jobs in the workflow. |
| 14 | `build:` | Defines a job with the identifier `build`. |
| 15 | `runs-on: ubuntu-latest` | Runs the build job on a GitHub-hosted Ubuntu runner. `ubuntu-latest` is a moving runner image, not a fixed Ubuntu version. |
| 16 | `steps:` | Begins the ordered steps executed by the build job. |
| 17 | `- uses: actions/checkout@v4` | Checks out the revision associated with the run so subsequent steps can access the repository files. `@v4` selects version 4 of the action. |
| 18 | `- uses: actions/setup-node@v4` | Runs version 4 of the Node.js setup action. |
| 19 | `with:` | Begins the inputs passed to `actions/setup-node`. |
| 20 | `node-version: 22` | Selects Node.js 22 for the npm commands in this job. |
| 21 | `cache: npm` | Enables caching of npm's package download data, using the dependency lockfile as part of the cache key. It does not cache `node_modules` itself. |
| 22 | `- run: npm ci` | Installs dependencies from `package-lock.json` for a clean, reproducible CI install. |
| 23 | `- run: npm test` | Runs the project's test script, which runs Vitest. A failure prevents subsequent steps from running normally. |
| 24 | `- run: npm run build -- --base=./` | Runs the build script: Vue/TypeScript type-checking followed by a Vite production build. The first `--` forwards `--base=./` to Vite, making generated asset URLs relative so they work under the repository's Pages path. |
| 25 | `- uses: actions/upload-pages-artifact@v3` | Packages and uploads the built site as a Pages artifact for the deploy job. This upload also happens in successful pull request builds, even though those runs do not deploy. |
| 26 | `with:` | Begins the inputs passed to the artifact upload action. |
| 27 | `path: dist` | Selects the `dist` directory produced by the Vite build as the artifact's contents. |
| 29 | `deploy:` | Defines a separate job with the identifier `deploy`. |
| 30 | `if: github.event_name != 'pull_request' && startsWith(github.ref, 'refs/heads/release')` | Selects non-pull-request runs whose ref begins with `refs/heads/release`. GitHub expression string comparisons are case-insensitive; the case-sensitive check on lines 43–48 prevents differently capitalized branches from deploying. |
| 31 | `needs: build` | Makes deployment wait for the `build` job and, with the default success behavior, prevents it from running if the build fails or is skipped. |
| 32 | `runs-on: ubuntu-latest` | Runs the deploy job on a separate GitHub-hosted Ubuntu runner. The built files are passed through the uploaded artifact, not a shared local directory. |
| 33 | `permissions:` | Sets permissions for the deploy job's `GITHUB_TOKEN`; this job-level setting overrides the workflow-level permission set for this job. |
| 34 | `pages: write` | Allows the job to create a GitHub Pages deployment. |
| 35 | `id-token: write` | Allows the job to request an OpenID Connect (OIDC) token, which GitHub Pages uses to verify the deployment. |
| 36 | `concurrency:` | Starts the rules that coordinate overlapping deploy jobs. |
| 37 | `group: pages` | Places deploy jobs in the same `pages` concurrency group so they do not deploy concurrently. |
| 38 | `cancel-in-progress: false` | Does not cancel a deployment that is already running when another run enters the group. GitHub may replace an older pending run with a newer pending run. |
| 39 | `environment:` | Associates this job with a GitHub environment. Any environment protection rules still apply. |
| 40 | `name: github-pages` | Uses the environment named `github-pages`. |
| 41 | `url: ${{ steps.deployment.outputs.page_url }}` | Sets the environment's URL to the `page_url` output from the step whose ID is `deployment`. |
| 42 | `steps:` | Begins the ordered steps for the deploy job. |
| 43 | `- name: Verify release branch` | Names a step that verifies the branch before deployment. |
| 44 | `run: \|` | Runs the following indented lines as a shell script. The YAML `\|` preserves their line breaks. |
| 45 | `case "$GITHUB_REF" in` | Starts a case-sensitive shell check against the run's Git ref. |
| 46 | `refs/heads/release*) ;;` | Accepts branch refs beginning exactly with lowercase `release`. |
| 47 | `*) echo "Deployment requires a branch beginning with release" >&2; exit 1 ;;` | Reports an error and stops the job for any other ref, including differently capitalized branches selected in a manual run. |
| 48 | `esac` | Ends the shell `case` statement. |
| 49 | `- id: deployment` | Gives the deployment step the ID referenced on line 41. |
| 50 | `uses: actions/deploy-pages@v4` | Runs version 4 of GitHub's Pages deployment action. It publishes the Pages artifact uploaded by the build job and supplies the `page_url` output. This is the step that actually deploys the site. |

## GitHub setup

1. In the repository's **Settings → Pages**, set the build and deployment source to **GitHub Actions**.
2. In **Settings → Environments → github-pages**, ensure the deployment branch rules allow the release branches you use. For selected branches, add matching patterns such as `release*` and `release*/*`; environment branch-rule wildcards do not match `/`, so deeper branch names need additional matching rules. If only protected branches may deploy, protect the relevant release branches or change that rule.

You do not need to create or edit a `pages-build-deployment` file. To inspect either workflow, open its Actions link above and select a run to see its trigger, commit, jobs, and logs.

The workflow grants read access to repository contents for the build and grants the deploy job Pages write and OIDC token permissions. Environment protection rules, such as required reviewers, still apply.

The published site is available at [krischilds.github.io/tower-defense-2026](https://krischilds.github.io/tower-defense-2026/).

## Troubleshooting

- **A release branch is not allowed to deploy:** Check the `github-pages` environment's deployment branch rules and ensure a rule matches the branch. If it allows protected branches only, check the repository's branch protection rules.
- **Creating Pages deployment failed with 404:** Check that GitHub Pages is enabled and its source is set to **GitHub Actions**.
- **The site requests `/src/main.ts` and gets a 404:** Pages is serving the source `index.html` rather than the Vite build. Set **Settings → Pages → Build and deployment → Source** to **GitHub Actions**, then run **Build and deploy** on a release branch. If branch-based publishing is enabled, its generated workflow can overwrite the custom workflow's deployment.
- **Build failed:** Open the failed workflow run in **Actions** and inspect the failing install, test, or build step. The deploy job will not run until the build succeeds.

After correcting a setting or failure, rerun the failed job or start a new workflow run on the appropriate branch.
