#!/bin/sh
# Container start: Fly.io mounts volumes owned by root, so hand the data folder to the aiden
# user, then run the worker command as that user.
set -eu
if [ "$(id -u)" = 0 ]; then
  install -d -o aiden -g aiden -m 0700 /data/home
  chown aiden:aiden /data
fi
exec aiden-teams "$@"
