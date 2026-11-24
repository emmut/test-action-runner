# Summarise `vmstat -n -S M <interval>` output. Needs -v total=<MiB RAM> -v cpus=<n>.
$1 == "r" { for (i = 1; i <= NF; i++) col[$i] = i; next }
col["r"] && $1 ~ /^[0-9]+$/ {
  if (++seen == 1) next  # first row is since-boot averages
  n++
  used = total - $col["free"] - $col["buff"] - $col["cache"]
  if (used > peak) peak = used
  if ($col["id"] < 5) sat++
  rq += $col["r"]; if ($col["r"] > maxr) maxr = $col["r"]
  if ($col["wa"] > maxwa) maxwa = $col["wa"]
  if ($col["si"] + $col["so"] > maxsw) maxsw = $col["si"] + $col["so"]
}
END {
  if (!n) { print "No vmstat samples"; exit }
  printf "## Resources during tests (%d samples, %d vCPU, %d MiB RAM)\n", n, cpus, total
  print "| metric | value |\n|---|---|"
  printf "| peak RAM used (excl. cache) | %d MiB (%.0f%%) |\n", peak, peak * 100 / total
  printf "| time CPU saturated (idle < 5%%) | %.0f%% |\n", sat * 100 / n
  printf "| run queue avg / max (vs %d vCPU) | %.1f / %d |\n", cpus, rq / n, maxr
  printf "| max iowait | %d%% |\n", maxwa
  printf "| max swap in+out per s | %d |\n", maxsw
}
