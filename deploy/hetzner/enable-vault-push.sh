#!/usr/bin/env bash
# Send every commit of the vault to a private GitHub repository, as an off-server backup.
#   deploy/hetzner/enable-vault-push.sh root@203.0.113.7 owner/repo
# First run prints the server's public key: add it to the repository as a deploy key WITH write access
# (github.com/<owner>/<repo>/settings/keys/new), then run the script again.
set -euo pipefail
host=${1:?usage: enable-vault-push.sh user@host owner/repo}; repo=${2:?usage: enable-vault-push.sh user@host owner/repo}
ssh "$host" bash -s -- "$repo" <<'REMOTE'
set -euo pipefail
repo=$1; cd /opt/defluance
if [ ! -f ssh/id_ed25519 ]; then
  mkdir -p ssh
  ssh-keygen -q -t ed25519 -N '' -C "defluance-vault-deploy@$(hostname)" -f ssh/id_ed25519
  ssh-keyscan -t ed25519 github.com 2>/dev/null > ssh/known_hosts
  chown -R 1000:1000 ssh; chmod 700 ssh; chmod 600 ssh/id_ed25519
  echo "Add this deploy key (write access) to github.com/$repo, then run this script again:"; cat ssh/id_ed25519.pub; exit 0
fi
git() { command git -c safe.directory='*' -C vault "$@"; }
git remote get-url origin >/dev/null 2>&1 && git remote set-url origin "git@github.com:$repo.git" || git remote add origin "git@github.com:$repo.git"
if ! grep -q '^vault_push:' vault/.defluance/config.yaml; then
  printf '\nvault_push: true   # every commit is sent to origin (off-server backup)\n' >> vault/.defluance/config.yaml
  git add .defluance/config.yaml; git -c user.name=Defluance -c user.email=defluance@localhost commit -qm "enable vault_push"
fi
chown -R 1000:1000 vault   # the commit above ran as root: the container user must keep owning the whole repository
GIT_SSH_COMMAND='ssh -i /opt/defluance/ssh/id_ed25519 -o UserKnownHostsFile=/opt/defluance/ssh/known_hosts -o IdentitiesOnly=yes' git push -u origin HEAD
docker compose up -d --build defluance >/dev/null 2>&1
echo "vault_push enabled: $(git rev-parse --short HEAD) is on $repo"
REMOTE
