#!/usr/bin/env python3
"""Lunch benchmark: run every runner test in sequence and write one results table.

    ./runner/lunch-test.py              # full run (~45-60 min), incl. GitHub-hosted baseline
    ./runner/lunch-test.py --no-github  # skip the billed GitHub-hosted baseline
    ./runner/lunch-test.py --ref-name myapp --ref-test-s 756 --ref-job-s 1037
                                        # also estimate an existing project's CI time here
    ./runner/lunch-test.py --report results/lunch-XXXX.json   # rebuild the table from saved data
    ./runner/lunch-test.py --parse RUN_ID                      # debug: parsed metrics for one run

Don't use the Mac while it runs: anything else on the host skews the numbers.
"""
import argparse
import datetime as dt
import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path

REPO = "emmut/test-action-runner"
ROOT = Path(__file__).resolve().parent.parent
RUNNERS = 3

E2E = "e2e.yml"
REPEAT = "2"  # heavy suite x2 = 210 test runs per job
GITHUB = ("github", E2E, {"runner": "github", "workers": "[1]", "copies": "[1]", "repeat_each": REPEAT})
LOCAL = [
    ("stress", "stress.yml", {"duration": "300"}),
    ("scaling", E2E, {"workers": "[1, 2, 4, 6]", "copies": "[1]", "max_parallel": "1", "repeat_each": REPEAT}),
    ("concurrent-2", E2E, {"workers": "[1]", "copies": "[1, 2]", "max_parallel": "2", "repeat_each": REPEAT}),
    ("concurrent-3", E2E, {"workers": "[1]", "copies": "[1, 2, 3]", "max_parallel": "3", "repeat_each": REPEAT}),
    ("concurrent-3-w2", E2E, {"workers": "[2]", "copies": "[1, 2, 3]", "max_parallel": "3", "repeat_each": REPEAT}),
]

ANSI = re.compile(r"\x1b\[[0-9;?]*[a-zA-Z]")


def sh(*args, check=True):
    return subprocess.run(args, check=check, capture_output=True, text=True).stdout


def gh(*args):
    return sh("gh", *args, "-R", REPO)


def log(msg):
    print(f"[{dt.datetime.now():%H:%M:%S}] {msg}", flush=True)


# ---------- orchestration ----------

def dispatch(workflow, inputs):
    before = {r["databaseId"] for r in json.loads(gh("run", "list", "-w", workflow, "-L", "20", "--json", "databaseId"))}
    gh("workflow", "run", workflow, *[x for k, v in inputs.items() for x in ("-f", f"{k}={v}")])
    for _ in range(40):
        time.sleep(3)
        runs = json.loads(gh("run", "list", "-w", workflow, "-L", "20", "--json", "databaseId"))
        new = [r["databaseId"] for r in runs if r["databaseId"] not in before]
        if new:
            return max(new)
    sys.exit(f"Run for {workflow} never appeared")


def wait(run_id, timeout_s=75 * 60):
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        if json.loads(gh("run", "view", str(run_id), "--json", "status"))["status"] == "completed":
            return
        time.sleep(30)
    log(f"run {run_id} still not done after {timeout_s // 60} min; cancelling")
    gh("run", "cancel", str(run_id))


# ---------- parsing ----------

def secs(a, b):
    f = "%Y-%m-%dT%H:%M:%SZ"
    return int((dt.datetime.strptime(b, f) - dt.datetime.strptime(a, f)).total_seconds()) if a and b else None


ROW_PATTERNS = {
    "e2e": re.compile(r"^\| (\d+) \| (\d+) \| (\d+) \| (\d+) \| (\d+)s \|$"),
    "ram": re.compile(r"^\| peak RAM used.*\| (\d+) MiB \((\d+)%\) \|$"),
    "sat": re.compile(r"^\| time CPU saturated.*\| (\d+)% \|$"),
    "runq": re.compile(r"^\| run queue avg / max \(vs (\d+) vCPU\) \| ([\d.]+) / (\d+) \|$"),
}
STRESS_PATTERNS = {
    "cpu_single": r"^\| single-thread \| ([\d.]+) \|",
    "cpu_multi": r"^\| all \d+ threads \| ([\d.]+) \|",
    "throttle": r"^Last vs first slice: \*\*(-?[\d.]+)%\*\*",
    "mem_bw": r"^\| sysbench bandwidth \| ([\d.]+) MiB/sec \|",
    "disk_seq_w": r"^\| seq write 1M \| (\d+) MiB/s \|",
    "disk_seq_r": r"^\| seq read 1M \| (\d+) MiB/s \|",
    "disk_rand": r'^\| rand 4k r/w IOPS \| "?([\d /]+)"? \|',
    "net_mbit": r"^GitHub release download: \*\*([\d.]+) Mbit/s\*\*",
    "npm_install": r"^\| npm install \| (\d+) \|",
    "next_build": r"^\| build \(cold\) \| (\d+) \|",
    "docker_build": r"^\*\*(\d+)s\*\* incl\. base image pull",
    "vcpus": r"^vCPUs: (\d+)",
}


def parse(run_id):
    meta = json.loads(gh("run", "view", str(run_id), "--json", "jobs,conclusion,url"))
    lines = {}
    for raw in gh("run", "view", str(run_id), "--log").splitlines():
        parts = raw.split("\t", 2)
        if len(parts) == 3:
            text = re.sub(r"^\S+Z ", "", ANSI.sub("", parts[2])).strip()
            lines.setdefault(parts[0], []).append(text)
    jobs = []
    for j in meta["jobs"]:
        out = {"name": j["name"], "conclusion": j["conclusion"], "job_s": secs(j["startedAt"], j["completedAt"])}
        for s in j["steps"]:
            if s["name"] == "Run E2E tests":
                out["test_step_s"] = secs(s["startedAt"], s["completedAt"])
        m = re.search(r"workers=(\d+)(?:, copy (\d+))?", j["name"])
        if m:
            out["workers"], out["copy"] = int(m[1]), int(m[2] or 1)
        for text in lines.get(j["name"], []):
            for key, pat in ROW_PATTERNS.items():
                if (mm := pat.match(text)):
                    out[key] = [float(x) for x in mm.groups()]
            for key, pat in STRESS_PATTERNS.items():
                if (mm := re.match(pat, text)):
                    out[key] = mm[1]
        jobs.append(out)
    return {"run_id": run_id, "url": meta["url"], "conclusion": meta["conclusion"], "jobs": jobs}


# ---------- report ----------

def fmt_s(s):
    return "—" if s is None else f"{s // 60}m{s % 60:02d}s"


def e2e_cells(j):
    passed, failed, flaky, _, dur = j.get("e2e", [None] * 5)
    ram = j.get("ram")
    runq = j.get("runq")
    return {
        "test_s": int(dur) if dur is not None else None,
        "passed": "—" if passed is None else int(passed),
        "failed": "—" if failed is None else int(failed),
        "flaky": "—" if flaky is None else int(flaky),
        "ram": f"{int(ram[0])} MiB ({int(ram[1])}%)" if ram else "—",
        "runq": f"{runq[1]:.1f} / {int(runq[2])} (of {int(runq[0])})" if runq else "—",
        "sat": f"{int(j['sat'][0])}%" if j.get("sat") else "—",
    }


def report(data):
    out = [f"# Runner benchmark — {data['started']}", ""]
    out += [f"- **Host:** {data['host']}", f"- **VM:** {data['vm']}", f"- **Runners in VM:** {RUNNERS}",
            f"- **Suite:** heavy BTS e2e, 105 tests (chromium/firefox/webkit) × repeat {REPEAT} = 210 test runs/job", ""]
    runs = data["runs"]

    if "stress" in runs:
        s = runs["stress"]["jobs"]
        get = lambda k: next((j[k] for j in s if k in j), "—")
        out += ["## Synthetic", "", "| metric | value |", "|---|---|",
                f"| CPU single-thread (sysbench events/s) | {get('cpu_single')} |",
                f"| CPU all {get('vcpus')} vCPU (events/s) | {get('cpu_multi')} |",
                f"| Sustained 300s: last vs first slice (negative = throttling) | {get('throttle')}% |",
                f"| Memory bandwidth | {get('mem_bw')} MiB/s |",
                f"| Disk seq write / read | {get('disk_seq_w')} / {get('disk_seq_r')} MiB/s |",
                f"| Disk random 4k IOPS (r / w) | {get('disk_rand')} |",
                f"| Network (GitHub download) | {get('net_mbit')} Mbit/s |",
                f"| npm install / Next.js cold build | {get('npm_install')}s / {get('next_build')}s |",
                f"| Docker build (no cache) | {get('docker_build')}s |", ""]

    solo = None
    if "scaling" in runs:
        out += ["## One job, more Playwright workers", "",
                "| workers | test time | job time | passed | failed | flaky | peak RAM (VM) | run queue avg / max | CPU saturated |",
                "|---|---|---|---|---|---|---|---|---|"]
        for j in sorted(runs["scaling"]["jobs"], key=lambda j: j.get("workers", 0)):
            c = e2e_cells(j)
            if j.get("workers") == 1:
                solo = c["test_s"]
            out.append(f"| {j.get('workers')} | {fmt_s(c['test_s'])} | {fmt_s(j['job_s'])} | {c['passed']} | {c['failed']} "
                       f"| {c['flaky']} | {c['ram']} | {c['runq']} | {c['sat']} |")
        out.append("")

    conc = [k for k in runs if k.startswith("concurrent")]
    capacity = 1 if solo else None
    if conc:
        out += ["## Several jobs at once (simultaneous PRs)", "",
                "| scenario | jobs ok | slowest test time | vs solo | failed tests | flaky | peak RAM (VM) | run queue avg / max |",
                "|---|---|---|---|---|---|---|---|"]
        for key in conc:
            cells = [e2e_cells(j) for j in runs[key]["jobs"]]
            times = [c["test_s"] for c in cells if c["test_s"]]
            slowest = max(times) if times else None
            failed = sum(c["failed"] for c in cells if isinstance(c["failed"], int))
            # A job killed before tests (e.g. OOM during build) has no test results but still failed.
            ok = sum(j["conclusion"] == "success" for j in runs[key]["jobs"])
            flaky = sum(c["flaky"] for c in cells if isinstance(c["flaky"], int))
            ratio = f"{slowest / solo:.2f}×" if slowest and solo else "—"
            worst = max(runs[key]["jobs"], key=lambda j: (j.get("runq") or [0, 0, 0])[1])
            w = e2e_cells(worst)
            out.append(f"| {key} | {ok}/{len(cells)} | {fmt_s(slowest)} | {ratio} | {failed} | {flaky} | {w['ram']} | {w['runq']} |")
            if solo and slowest and failed == 0 and ok == len(cells) and slowest <= 1.5 * solo and "-w" not in key:
                capacity = max(capacity, len(cells))
        out.append("")

    if "github" in runs:
        g = e2e_cells(runs["github"]["jobs"][0])
        gj = runs["github"]["jobs"][0]
        out += ["## Baseline: GitHub-hosted ubuntu-24.04", "",
                "| runner | test time | job time | passed | failed | flaky | peak RAM | run queue avg / max |",
                "|---|---|---|---|---|---|---|---|",
                f"| GitHub ubuntu-24.04 | {fmt_s(g['test_s'])} | {fmt_s(gj['job_s'])} | {g['passed']} | {g['failed']} | {g['flaky']} | {g['ram']} | {g['runq']} |"]
        if solo:
            out.append(f"| This Mac (VM, 1 job) | {fmt_s(solo)} | | | | | | |")
        out.append("")
        if solo and g["test_s"]:
            speed = g["test_s"] / solo
            out += ["## Summary", "", "| metric | value |", "|---|---|",
                    f"| This Mac vs GitHub-hosted, same suite | **{speed:.1f}× faster** |",
                    f"| Concurrent e2e jobs before >1.5× slowdown or failures | **{capacity}** |"]
            ref = data.get("ref")
            if ref:
                out += [f"| {ref['name']} e2e tests on GitHub (given) | {fmt_s(ref['test_s'])} (job {fmt_s(ref.get('job_s'))}) |",
                        f"| {ref['name']} e2e tests on this Mac (estimate) | **{fmt_s(int(ref['test_s'] / speed))}** |"]
            out.append("")

    out += ["## How to read this", "",
            "- Capacity rule: most simultaneous jobs, all succeeding, with 0 failed tests and slowest job ≤ 1.5× a solo job.",
            "- Run queue above the vCPU count means CPU-bound; RAM % near 90+ means memory-bound.",
            "- These numbers are this Mac's chip in a Linux VM. A candidate with more CPU throughput and the same RAM"
            " raises capacity only if the run queue, not RAM, is the limit here.", "",
            "Runs: " + ", ".join(f"[{k}]({v['url']})" for k, v in runs.items())]
    return "\n".join(out) + "\n"


# ---------- main ----------

def host_info():
    brand = sh("sysctl", "-n", "machdep.cpu.brand_string").strip()
    cores = sh("sysctl", "-n", "hw.ncpu").strip()
    mem = int(sh("sysctl", "-n", "hw.memsize")) // 2**30
    vm = json.loads(sh("limactl", "list", "gh-runner", "--json") or "{}")
    vm_s = f"gh-runner: {vm.get('cpus')} vCPU, {int(vm.get('memory', 0)) // 2**30} GiB RAM, {int(vm.get('disk', 0)) // 2**30} GiB disk" if vm else "unknown"
    return f"{brand}, {cores} cores, {mem} GB RAM", vm_s


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--no-github", action="store_true", help="skip GitHub-hosted baseline (billed minutes)")
    ap.add_argument("--report", type=Path, help="rebuild markdown from a saved results JSON")
    ap.add_argument("--parse", type=int, help="print parsed metrics for one run id")
    ap.add_argument("--ref-name", help="name of an existing project to estimate (kept out of the repo)")
    ap.add_argument("--ref-test-s", type=int, help="that project's e2e test time on GitHub-hosted, seconds")
    ap.add_argument("--ref-job-s", type=int, help="that project's e2e job time on GitHub-hosted, seconds")
    args = ap.parse_args()

    if args.parse:
        print(json.dumps(parse(args.parse), indent=2))
        return
    if args.report:
        data = json.loads(args.report.read_text())
        args.report.with_suffix(".md").write_text(report(data))
        print(report(data))
        return

    # Keep the Mac awake for as long as this process lives.
    subprocess.Popen(["caffeinate", "-dims", "-w", str(os.getpid())])
    if "Battery Power" in sh("pmset", "-g", "batt"):
        log("WARNING: on battery; plug in for representative numbers")

    log(f"Preparing VM and {RUNNERS} runners (runner/setup.sh)")
    subprocess.run([str(ROOT / "runner/setup.sh")], env={**os.environ, "RUNNER_COUNT": str(RUNNERS)}, check=True,
                   stdout=subprocess.DEVNULL)
    # Freshly started runners take a few seconds to connect.
    for _ in range(12):
        online = int(sh("gh", "api", f"repos/{REPO}/actions/runners", "--jq", '[.runners[] | select(.status=="online")] | length'))
        if online >= RUNNERS:
            break
        time.sleep(5)
    else:
        sys.exit(f"Only {online}/{RUNNERS} runners online")

    stamp = dt.datetime.now().strftime("%Y%m%d-%H%M")
    host, vm = host_info()
    data = {"started": dt.datetime.now().strftime("%Y-%m-%d %H:%M"), "host": host, "vm": vm, "runs": {}}
    if args.ref_name and args.ref_test_s:
        data["ref"] = {"name": args.ref_name, "test_s": args.ref_test_s, "job_s": args.ref_job_s}
    results = ROOT / "results"
    results.mkdir(exist_ok=True)
    out_json = results / f"lunch-{stamp}.json"

    ids = {}
    if not args.no_github:
        # Remote hardware: runs alongside the local tests without affecting them.
        ids["github"] = dispatch(*GITHUB[1:])
        log(f"github baseline dispatched: run {ids['github']}")
    for key, wf, inputs in LOCAL:
        log(f"{key}: starting")
        ids[key] = dispatch(wf, inputs)
        wait(ids[key])
        data["runs"][key] = parse(ids[key])
        out_json.write_text(json.dumps(data, indent=2))
        log(f"{key}: {data['runs'][key]['conclusion']}")
    if "github" in ids:
        wait(ids["github"])
        data["runs"]["github"] = parse(ids["github"])
    out_json.write_text(json.dumps(data, indent=2))

    md = report(data)
    out_json.with_suffix(".md").write_text(md)
    print("\n" + md)
    log(f"Saved {out_json.with_suffix('.md')}")


if __name__ == "__main__":
    main()
