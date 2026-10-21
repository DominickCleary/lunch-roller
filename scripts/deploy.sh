#!/usr/bin/env bash
set -euo pipefail

fail() {
  printf 'Deployment stopped: %s\n' "$1" >&2
  exit 1
}

[[ $# -eq 2 ]] || fail 'Usage: bash scripts/deploy.sh /absolute/server/checkout <tested-commit-sha>'
deploy_path=$1
deploy_sha=${2,,}
[[ "$deploy_path" = /* ]] || fail 'The server checkout path must be absolute.'
[[ "$deploy_sha" =~ ^[0-9a-f]{40}$ ]] || fail 'A full tested commit SHA is required.'
[[ -d "$deploy_path" ]] || fail 'The server checkout does not exist. Set DEPLOY_PATH to its existing folder.'

for executable in git docker flock; do
  command -v "$executable" >/dev/null || fail "Required command is unavailable: $executable"
done

source_path=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)
deploy_path=$(cd -- "$deploy_path" && pwd -P)
case "$source_path/" in "$deploy_path/"*) fail 'Install the runner outside the production checkout.' ;; esac
case "$deploy_path/" in "$source_path/"*) fail 'The production checkout must be outside the runner workspace.' ;; esac

[[ $(git -C "$source_path" rev-parse HEAD) == "$deploy_sha" ]] || fail 'The runner checkout does not match the tested commit.'
[[ $(git -C "$deploy_path" rev-parse --show-toplevel) == "$deploy_path" ]] || fail 'DEPLOY_PATH must point to the repository root.'

# The runner checkout uses HTTPS; an existing server clone may use SSH.
repository_name() {
  local remote=$1
  remote=${remote#https://github.com/}
  remote=${remote#ssh://git@github.com/}
  remote=${remote#git@github.com:}
  printf '%s' "${remote%.git}"
}
source_remote=$(git -C "$source_path" remote get-url origin)
deploy_remote=$(git -C "$deploy_path" remote get-url origin)
[[ $(repository_name "$source_remote") == "$(repository_name "$deploy_remote")" ]] || fail 'The runner and server checkouts belong to different repositories.'

cd -- "$deploy_path"
exec 9>"$(git rev-parse --git-path lunch-roller-deploy.lock)"
flock --exclusive --nonblock 9 || fail 'Another deployment already holds the server lock.'

[[ $(git branch --show-current) == main ]] || fail 'The server checkout must already be on main.'
[[ -z $(git status --porcelain --untracked-files=normal) ]] || fail 'The server checkout has local changes. Resolve them before deploying.'
[[ -f .env ]] || fail 'The server checkout needs its existing .env configuration.'
[[ -f compose.yaml ]] || fail 'The server checkout has no compose.yaml.'
docker compose version >/dev/null

# Transfer the exact CI checkout locally; no extra GitHub key/token is needed
# in the production clone, and production .env stays outside runner checkout.
git fetch --no-tags -- "$source_path" "$deploy_sha"
current_sha=$(git rev-parse HEAD)
if [[ "$current_sha" != "$deploy_sha" ]] && git merge-base --is-ancestor "$deploy_sha" "$current_sha"; then
  printf 'Skipping older deployment %s; the server already has a newer commit.\n' "$deploy_sha"
  exit 0
fi
git merge-base --is-ancestor "$current_sha" "$deploy_sha" || fail 'The server has commits outside the tested main history. No reset was performed.'
git merge --ff-only --no-edit "$deploy_sha"

docker compose up -d --build --wait --wait-timeout 300
printf 'Deployed %s; Compose services are healthy.\n' "$deploy_sha"
