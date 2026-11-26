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
| Push to `master` | Yes | Yes, if the build succeeds |
| Push to a branch beginning with `release` | Yes | No |
| Pull request targeting `master` or a branch beginning with `release` | Yes | No |
| Manual run on any branch, environment `dev` (default) | Yes | Yes, if the build succeeds |
| Manual run on any branch, environment `prod` | Yes | No; AWS deployment is not configured yet |

`master` is the dev track for automatic pushes. Branches beginning with `release` are the prod track; examples include `release`, `release-1.0`, `release/1.0`, and `release/1.0/fix`. Pushes to release branches currently build and test but do not deploy. Other branches do not trigger a push build. To deploy manually, open **Actions → Build and deploy → Run workflow**, choose any branch and the `dev` environment, then click **Run workflow**. `prod` can be selected, but currently has no deployment job; add the AWS deployment there after AWS is configured. The workflow file must be present on the default branch for manual runs to be available.

## What it does

The **build** job runs on Ubuntu and:

1. Checks out the code and sets up Node.js 22 with an npm cache.
2. Runs `npm ci` to install dependencies from the lockfile.
3. Runs `npm test`.
4. Runs `npm run build -- --base=./` to type-check and build the site. Relative asset paths allow the site to work under the repository's Pages URL.
5. Uploads `dist` as a GitHub Pages artifact.

The **deploy** job runs after a successful build for pushes to `master` or manual runs that select `dev`. Manual runs can select `dev` from any branch. It publishes the artifact using `actions/deploy-pages` and records the site URL in the `dev` environment. This is the only deployment target currently configured. Selecting `prod` does not deploy; when AWS is set up, add a separate job that uses the `prod` environment. Deployments use the `pages` concurrency group so a running deployment is not cancelled by a newer one.

## `deploy.yml` line by line

The line numbers below refer to [`deploy.yml`](deploy.yml). YAML indentation groups settings under their parent; lines beginning with `-` are items in a list. Only relevant nonblank lines are listed.

| Line | Code | Explanation |
| --- | --- | --- |
| 1 | `name: Build and deploy` | Names the workflow as it appears in the GitHub Actions interface. |
| 3 | `on:` | Begins the list of events that can start a workflow run. |
| 4 | `push:` | Enables runs for pushes to the repository. |
| 5 | `branches: [master, 'release*', 'release*/**']` | Restricts push runs to `master` and branches beginning with `release`. The second release pattern also matches branch names containing slashes. |
| 6 | `pull_request:` | Enables runs for pull request events. |
| 7 | `branches: [master, 'release*', 'release*/**']` | Restricts this trigger to pull requests **targeting** `master` or a branch beginning with `release`; it does not filter the source branch. |
| 8 | `workflow_dispatch:` | Allows someone with appropriate access to start the workflow manually from GitHub Actions and choose a branch and deployment environment. |
| 9 | `inputs:` | Starts the options shown when someone manually runs the workflow. |
| 10 | `environment:` | Defines the deployment environment input. |
| 11 | `description: Choose the target; prod deployment is not configured yet` | Explains that `prod` is selectable but has no deployment target yet. |
| 12 | `required: true` | Requires an environment choice for a manual run. |
| 13 | `type: choice` | Displays a fixed list of allowed environment choices. |
| 14 | `options:` | Begins the list of environment choices. |
| 15–16 | `- dev`, `- prod` | Lets the user choose dev or prod. |
| 17 | `default: dev` | Selects dev by default for manual runs. |
| 19 | `permissions:` | Starts the workflow-level permissions for the automatically provided `GITHUB_TOKEN`. |
| 20 | `contents: read` | Allows the workflow token to read repository contents, including the code checked out by the build. |
| 22 | `jobs:` | Begins the jobs in the workflow. |
| 23 | `build:` | Defines a job with the identifier `build`. |
| 24 | `runs-on: ubuntu-latest` | Runs the build job on a GitHub-hosted Ubuntu runner. `ubuntu-latest` is a moving runner image, not a fixed Ubuntu version. |
| 25 | `steps:` | Begins the ordered steps executed by the build job. |
| 26 | `- uses: actions/checkout@v4` | Checks out the revision associated with the run so subsequent steps can access the repository files. `@v4` selects version 4 of the action. |
| 27 | `- uses: actions/setup-node@v4` | Runs version 4 of the Node.js setup action. |
| 28 | `with:` | Begins the inputs passed to `actions/setup-node`. |
| 29 | `node-version: 22` | Selects Node.js 22 for the npm commands in this job. |
| 30 | `cache: npm` | Enables caching of npm's package download data, using the dependency lockfile as part of the cache key. It does not cache `node_modules` itself. |
| 31 | `- run: npm ci` | Installs dependencies from `package-lock.json` for a clean, reproducible CI install. |
| 32 | `- run: npm test` | Runs the project's test script, which runs Vitest. A failure prevents subsequent steps from running normally. |
| 33 | `- run: npm run build -- --base=./` | Runs the build script: Vue/TypeScript type-checking followed by a Vite production build. The first `--` forwards `--base=./` to Vite, making generated asset URLs relative so they work under the repository's Pages path. |
| 34 | `- uses: actions/upload-pages-artifact@v3` | Packages and uploads the built site as a Pages artifact for the deploy job. This upload also happens in successful pull request builds, even though those runs do not deploy. |
| 35 | `with:` | Begins the inputs passed to the artifact upload action. |
| 36 | `path: dist` | Selects the `dist` directory produced by the Vite build as the artifact's contents. |
| 38 | `deploy:` | Defines a separate job with the identifier `deploy`. |
| 39 | `if: ...` | Allows automatic dev deployment for pushes to `master` and manual dev deployments from any branch. Pull requests and manual prod selections do not deploy. |
| 45 | `needs: build` | Makes deployment wait for a successful build. |
| 46 | `runs-on: ubuntu-latest` | Runs the deploy job on a separate GitHub-hosted Ubuntu runner. The built files are passed through the uploaded artifact, not a shared local directory. |
| 47 | `permissions:` | Sets permissions for the deploy job's `GITHUB_TOKEN`; this job-level setting overrides the workflow-level permission set for this job. |
| 48 | `pages: write` | Allows the job to create a GitHub Pages deployment. |
| 49 | `id-token: write` | Allows the job to request an OpenID Connect (OIDC) token, which GitHub Pages uses to verify the deployment. |
| 51 | `concurrency:` | Starts the rules that coordinate overlapping deploy jobs. |
| 52 | `group: pages` | Places deploy jobs in the same `pages` concurrency group so they do not deploy concurrently. |
| 53 | `cancel-in-progress: false` | Does not cancel a deployment that is already running when another run enters the group. GitHub may replace an older pending run with a newer pending run. |
| 55 | `environment:` | Associates this job with a GitHub environment. Any environment protection rules still apply. |
| 56 | `name: dev` | Uses the `dev` environment for the GitHub Pages deployment. |
| 57 | `url: ${{ steps.deployment.outputs.page_url }}` | Sets the environment's URL to the `page_url` output from the step whose ID is `deployment`. |
| 58 | `steps:` | Begins the ordered steps for the deploy job. |
| 59 | `- id: deployment` | Gives the deployment step the ID referenced on line 57. |
| 60 | `uses: actions/deploy-pages@v4` | Runs version 4 of GitHub's Pages deployment action. It publishes the Pages artifact uploaded by the build job and supplies the `page_url` output. This is the step that actually deploys the site. |

## GitHub setup

1. In the repository's **Settings → Pages**, set the build and deployment source to **GitHub Actions**.
2. In **Settings → Environments**, use `dev` for GitHub Pages. Create `prod` for future AWS deployment. The manual workflow currently allows deploying `dev` from any selected branch, so do not configure a branch restriction on `dev` if that is the intended policy. Configure `prod` protection rules before adding its AWS deployment job. Do not add AWS credentials or an AWS deployment job to `dev`.

You do not need to create or edit a `pages-build-deployment` file. To inspect either workflow, open its Actions link above and select a run to see its trigger, commit, jobs, and logs.

The workflow grants read access to repository contents for the build and grants the dev deployment job Pages write and OIDC token permissions. Environment protection rules, such as required reviewers, still apply.

The published site is available at [krischilds.github.io/tower-defense-2026](https://krischilds.github.io/tower-defense-2026/).

## Troubleshooting

- **The dev deployment is not allowed:** Check the `dev` environment's deployment branch rules and ensure the selected branch is allowed.
- **Creating Pages deployment failed with 404:** Check that GitHub Pages is enabled and its source is set to **GitHub Actions**.
- **The site requests `/src/main.ts` and gets a 404:** Pages is serving the source `index.html` rather than the Vite build. Set **Settings → Pages → Build and deployment → Source** to **GitHub Actions**, then run **Build and deploy** on any branch with `dev` selected. If branch-based publishing is enabled, its generated workflow can overwrite the custom workflow's deployment.
- **Build failed:** Open the failed workflow run in **Actions** and inspect the failing install, test, or build step. The deploy job will not run until the build succeeds.

After correcting a setting or failure, rerun the failed job or start a new workflow run on the appropriate branch.
