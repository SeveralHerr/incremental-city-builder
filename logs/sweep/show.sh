#!/bin/sh
# usage: show.sh <label...>  -> summary lines for each
cd "C:/Users/gotmi/OneDrive/Documents/GitHub/incremental-simcity"
for l in "$@"; do
  for p in d s; do
    f="logs/sweep/$l-$p.txt"
    echo "== $l [$p]"
    grep -E "^\[probe\] (foundings|cycles|max ratio|emptyLate|margins)" "$f" | sed 's/\[probe\] //'
  done
done
