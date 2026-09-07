#!/bin/sh
# usage: run.sh <label> <probe args...>   -> runs default + saver in parallel, writes logs/sweep/<label>-{d,s}.txt
label=$1; shift
cd "C:/Users/gotmi/OneDrive/Documents/GitHub/incremental-simcity"
node src/balance/probe.mjs --cities "$@" > "logs/sweep/$label-d.txt" 2>&1 &
node src/balance/probe.mjs --cities --save 30 "$@" > "logs/sweep/$label-s.txt" 2>&1 &
wait
