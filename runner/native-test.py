#!/usr/bin/env python3
"""Native macOS runner benchmark: the same e2e job as the lunch test, but on GitHub runners
running directly on macOS (no Lima VM). One command, cleans up after itself.

    ./runner/native-test.py                 # ~20-25 min: 1 job, then 3 and 5 at once
    ./runner/native-test.py --ref main      # workflow from another branch (default: current)

What it does:
  1. stops the Lima VM (if running) so its memory doesn't count against the host
  2. registers 5 temporary native runners (runner/setup-mac.sh)
  3. runs e2e with runner=macos: 1 job (smoke test, aborts on failure), 3 at once, 5 at once,
     sampling host RAM, swap and CPU for each scenario
  4. writes results/native-<time>.md, removes the runners, restarts the Lima VM if it was running

Close heavy apps first (browsers, editors' TS servers, Docker containers): this measures the
whole Mac. Native jobs run as your user with access to your home dir; runners are removed at the end.
"""
import argparse
import datetime as dt
import importlib.util
import json
import os
import re
import subprocess
import sys
import threading
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("lunch", ROOT / "runner/lunch-test.py")
lunch = importlib.util.module_from_spec(spec)
spec.loader.exec_module(lunch)
sh, log, REPO = lunch.sh, lunch.log, lunch.REPO

RUNNERS = 5
SCENARIOS = [("native-1", "[1]"), ("native-3", "[1, 2, 3]"), ("native-5", "[1, 2, 3, 4, 5]")]


def vm_stat():
    out = sh("vm_stat")
    page = int(re.search(r"page size of (\d+)", out)[1])
    v = {k.strip().strip('"'): int(n) for k, n in re.findall(r"^(.+?):\s+(\d+)\.$", out, re.M)}
    used = (v["Pages active"] + v["Pages wired down"] + v["Pages occupied by compressor"]) * page // 2**20
    return used, v.get("Swapouts", 0) * page // 2**20


class Sampler(threading.Thread):
    """Host RAM used (active+wired+compressed), swap-out MiB and CPU idle, every ~2s."""

    def __init__(self):
        super().__init__(daemon=True)
        self.stop_ev, self.samples = threading.Event(), []
        self.base_used, self.base_swap = vm_stat()

    def run(self):
        while not self.stop_ev.is_set():
            used, swap = vm_stat()
            top = sh("top", "-l", "2", "-n", "0", "-s", "1")
            idle = float(re.findall(r"CPU usage:.*?([\d.]+)% idle", top)[-1])
            self.samples.append((used, swap, idle))
            time.sleep(1)

    def summary(self):
        self.stop_ev.set()
        self.join()
        s = self.samples or [(self.base_used, self.base_swap, 100.0)]
        return {
            "ram_before": self.base_used,
            "ram_peak": max(x[0] for x in s),
            "swapout_mib": max(x[1] for x in s) - self.base_swap,
            "idle_avg": sum(x[2] for x in s) / len(s),
            "saturated_pct": 100 * sum(x[2] < 5 for x in s) / len(s),
        }


def runners_online():
    return int(sh("gh", "api", f"repos/{REPO}/actions/runners", "--jq",
                  '[.runners[] | select(.status=="online" and (.name | startswith("mac-native-")))] | length'))


def report(data):
    out = [f"# Native macOS runner benchmark — {data['started']}", "",
           f"- **Host:** {data['host']} (no VM; jobs run directly on macOS)",
           f"- **Runners:** {RUNNERS} native, ports 4000+",
           f"- **Suite:** heavy BTS e2e, 105 tests × repeat {lunch.REPEAT} = 210 test runs/job, workers=1", "",
           "| scenario | jobs ok | slowest test time | vs native solo | slowest job | failed tests | flaky "
           "| host RAM before → peak | swapped out | CPU idle avg | CPU saturated |",
           "|---|---|---|---|---|---|---|---|---|---|---|"]
    solo = None
    for key, _ in SCENARIOS:
        r = data["runs"].get(key)
        if not r:
            continue
        cells = [lunch.e2e_cells(j) for j in r["jobs"]]
        ok = sum(j["conclusion"] == "success" for j in r["jobs"])
        times = [c["test_s"] for c in cells if c["test_s"]]
        slowest = max(times) if times else None
        solo = solo or slowest
        job_s = max((j["job_s"] or 0) for j in r["jobs"]) or None
        failed = sum(c["failed"] for c in cells if isinstance(c["failed"], int))
        flaky = sum(c["flaky"] for c in cells if isinstance(c["flaky"], int))
        h = r["host"]
        out.append(f"| [{key}]({r['url']}) | {ok}/{len(cells)} | {lunch.fmt_s(slowest)} "
                   f"| {f'{slowest / solo:.2f}×' if slowest and solo else '—'} | {lunch.fmt_s(job_s)} | {failed} | {flaky} "
                   f"| {h['ram_before']} → {h['ram_peak']} MiB | {h['swapout_mib']} MiB | {h['idle_avg']:.0f}% "
                   f"| {h['saturated_pct']:.0f}% |")
    out += ["", "## How to read this", "",
            "- Compare with the Lima VM (8 vCPU / 8 GiB) in results/lunch-*.md: VM solo test time was 2m18s, "
            "2 jobs at once OK, 3 at once lost jobs to OOM.",
            "- Native uses all 12 cores and 16 GB, so higher capacity here is mostly bigger limits, not VM overhead; "
            "the solo time is the overhead comparison.",
            "- macOS swaps instead of killing jobs: 'jobs ok' with large swap-out means it didn't really fit.",
            "- RAM is the whole Mac (incl. other apps), sampled every ~2s from the host, build phase included.", ""]
    return "\n".join(out)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--ref", default=sh("git", "-C", str(ROOT), "branch", "--show-current").strip() or "main",
                    help="branch whose e2e.yml to run (needs the runner=macos option)")
    ap.add_argument("--report", type=Path, help="rebuild markdown from a saved results JSON")
    args = ap.parse_args()
    if args.report:
        md = report(json.loads(args.report.read_text()))
        args.report.with_suffix(".md").write_text(md)
        print(md)
        return

    subprocess.Popen(["caffeinate", "-dims", "-w", str(os.getpid())])
    if "Battery Power" in sh("pmset", "-g", "batt"):
        log("WARNING: on battery; plug in for representative numbers")
    used, _ = vm_stat()
    total = int(sh("sysctl", "-n", "hw.memsize")) // 2**20
    log(f"Host RAM in use before start: {used} / {total} MiB")
    if used > total * 0.6:
        log("WARNING: over 60% in use; close browsers/editors/Docker containers for cleaner numbers")

    stamp = dt.datetime.now().strftime("%Y%m%d-%H%M")
    host, _ = lunch.host_info()
    data = {"started": dt.datetime.now().strftime("%Y-%m-%d %H:%M"), "host": host, "ref": args.ref, "runs": {}}
    results = ROOT / "results"
    results.mkdir(exist_ok=True)
    out_json = results / f"native-{stamp}.json"

    if subprocess.run(["docker", "info"], capture_output=True).returncode:
        sys.exit("Docker isn't running; start Docker Desktop first (jobs use it for Postgres)")
    lima_was_running = '"status":"Running"' in sh("limactl", "list", "gh-runner", "--json", check=False).replace(" ", "")
    if lima_was_running:
        log("Stopping Lima VM to free its memory")
        subprocess.run(["limactl", "stop", "gh-runner"], capture_output=True)
    try:
        log(f"Registering {RUNNERS} native runners (runner/setup-mac.sh)")
        subprocess.run([str(ROOT / "runner/setup-mac.sh")], env={**os.environ, "RUNNER_COUNT": str(RUNNERS)},
                       check=True, stdout=subprocess.DEVNULL)
        for _ in range(12):
            if runners_online() >= RUNNERS:
                break
            time.sleep(5)
        else:
            sys.exit(f"Only {runners_online()}/{RUNNERS} native runners online")

        for key, copies in SCENARIOS:
            log(f"{key}: starting")
            sampler = Sampler()
            sampler.start()
            run_id = lunch.dispatch(lunch.E2E, {"runner": "macos", "workers": "[1]", "copies": copies,
                                                "max_parallel": str(RUNNERS), "repeat_each": lunch.REPEAT}, ref=args.ref)
            lunch.wait(run_id)
            data["runs"][key] = {**lunch.parse(run_id), "host": sampler.summary()}
            out_json.write_text(json.dumps(data, indent=2))
            log(f"{key}: {data['runs'][key]['conclusion']}")
            if key == "native-1" and data["runs"][key]["conclusion"] != "success":
                log("Smoke test failed; skipping concurrent scenarios. See the run link in the report.")
                break
            time.sleep(15)  # let the machine settle between scenarios
    finally:
        log("Removing native runners")
        subprocess.run([str(ROOT / "runner/setup-mac.sh"), "remove"], capture_output=True)
        if lima_was_running:
            log("Starting Lima VM again")
            subprocess.run(["limactl", "start", "gh-runner"], capture_output=True)

    md = report(data)
    out_json.with_suffix(".md").write_text(md)
    print("\n" + md)
    log(f"Saved {out_json.with_suffix('.md')}")


if __name__ == "__main__":
    main()
