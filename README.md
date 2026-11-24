# test-action-runner

Evaluate a local Mac as a self-hosted GitHub Actions runner (Linux VM via [Lima](https://lima-vm.io)).

## Setup

```sh
./runner/setup.sh                    # VM "gh-runner": 8 vCPU, 8 GiB, 20 GiB disk, 1 runner
RUNNER_COUNT=2 ./runner/setup.sh     # add more runners to the same VM
```

Needs `limactl` and `gh` (logged in as a repo admin). The VM has no host mounts.
Lima VMs don't auto-start after reboot: `limactl start gh-runner`.

## Run the stress test

```sh
gh workflow run stress.yml -f duration=180
gh run watch
```

Results land in the run's job summaries: CPU (single/multi/sustained throttling),
memory, disk (fio), network, Next.js build, Docker build, and 4 parallel fixed workloads.

Numbers reflect this host's chip inside a Linux VM with the configured vCPUs, not a Mac mini.

## E2E simulation

`app/` is a stock [Better-T-Stack](https://better-t-stack.dev) monorepo (bun + turbo,
Next.js web, Hono/tRPC server, better-auth, Drizzle/Postgres) with 16 own Playwright
tests run on chromium/firefox/webkit (49 runs incl. setup), CI retries, prod build.

```sh
gh workflow run e2e.yml -f workers='[1, 4]' -f repeat_each=1
```

Raise `repeat_each` to scale the suite; compare worker counts to see how much
parallelism the box sustains.

## Lunch benchmark (one command, hands off)

```sh
./runner/lunch-test.py              # ~45-60 min; keeps the Mac awake; don't use it meanwhile
./runner/lunch-test.py --no-github  # skip the billed GitHub-hosted baseline
```

Sets up 3 runners, then runs: synthetic stress → one job at 1/2/4/6 workers →
2 and 3 simultaneous jobs → GitHub-hosted `ubuntu-24.04` baseline (in parallel,
remote). Writes `results/lunch-<time>.md` (tables) and `.json` (raw).

## Teardown

```sh
limactl delete -f gh-runner
gh api repos/emmut/test-action-runner/actions/runners -q '.runners[].id' \
  | xargs -I{} gh api -X DELETE repos/emmut/test-action-runner/actions/runners/{}
```
