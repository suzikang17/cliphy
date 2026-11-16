# Setting up the website task runner

One time, on the devbox. The runner (`apps/runner`) makes website changes that
the owner starts from Chat. Why it is built this way:
[ADR 0062](decisions/0062-devbox-poller-running-claude-code-headless.md).

Two users are made. `cliphy-runner` holds the GitHub login and the Cliphy key.
`cliphy-work` runs Claude Code and build commands and holds neither. Run the
`sudo` commands as your own admin user.

> Not yet run on a real machine. Fix this page wherever it turns out wrong.

## 1. Two users

```sh
sudo useradd --create-home --shell /bin/bash cliphy-runner
sudo useradd --create-home --shell /bin/bash cliphy-work
sudo chmod 700 /home/cliphy-runner /home/cliphy-work
```

Success: `sudo -u cliphy-work ls /home/cliphy-runner` says "Permission denied".

## 2. Let the runner act as the work user, and not the other way

```sh
echo 'cliphy-runner ALL=(cliphy-work) NOPASSWD: ALL' | sudo tee /etc/sudoers.d/cliphy-runner
sudo chmod 440 /etc/sudoers.d/cliphy-runner
sudo visudo -c
```

Success: `sudo -u cliphy-runner sudo -n -u cliphy-work true` prints nothing.
`cliphy-work` gets no sudo line at all.

## 3. Folders

```sh
sudo mkdir -p /srv/cliphy/repos /srv/cliphy/work
sudo chown cliphy-runner: /srv/cliphy/repos && sudo chmod 700 /srv/cliphy/repos
sudo chown cliphy-work:   /srv/cliphy/work  && sudo chmod 755 /srv/cliphy/work
```

The runner's clones live in `repos`, closed to everyone else: the work user
must not be able to read one client's code while working on another's, or run
anything that lands there. Claude's copies live in `work`; the runner reads
them once, to copy the changed files back.

Success: `sudo -u cliphy-work ls /srv/cliphy/repos` says "Permission denied".

## 4. Programs

For both users: Node 22 and pnpm. System-wide: `git`, `rsync`, `tar`, `curl`,
and `setsid`, `timeout` and `pkill` (in `util-linux`, `coreutils` and `procps`,
already there on Debian and Ubuntu).

- As `cliphy-runner`: the GitHub CLI (`gh`), and this repo:
  ```sh
  git clone https://github.com/<owner>/cliphy ~/cliphy && cd ~/cliphy && pnpm install
  pnpm --filter cliphy-runner exec playwright install --with-deps chromium
  ```
  (`--with-deps` needs sudo once; run that part as your admin user if asked.)
- As `cliphy-work`: Claude Code (`claude`), on the `PATH` that `sudo -u cliphy-work -H claude` sees.

Success: `sudo -u cliphy-runner sudo -n -u cliphy-work -H claude --version` prints a version.

## 5. Log Claude in as the work user

```sh
sudo -iu cliphy-work
claude        # then /login, with the owner's subscription
```

`cliphy-work` must not have `ANTHROPIC_API_KEY` set anywhere: it overrides the
subscription login.

Use `cliphy-work` for nothing else. Before every run the runner stops all of
that user's processes, empties its crontab and deletes its Claude settings and
package-manager config, so that one client's run cannot leave something behind
for the next.

Success: `echo "say hi" | claude -p` answers.

## 6. GitHub login for the runner

On GitHub, under the owner's account: Settings → Developer settings →
Fine-grained tokens → new token. Repository access: **only the client repos
the runner should work on**. Permissions: Contents read and write, Pull
requests read and write, Deployments read, Metadata read.

```sh
sudo -iu cliphy-runner
gh auth login --with-token   # paste the token
gh auth setup-git            # git uses gh for the password
git config --global user.name  "Cliphy Runner"
git config --global user.email "<an address GitHub accepts for the owner>"
```

Success: `gh auth status` is logged in, and `gh repo view <owner>/<repo>` works
for a repo in the token and fails for one outside it.

## 7. Protect the default branch of each client repo

GitHub cannot limit a token to branches named `cliphy/…`. The runner only
pushes those, but that rule lives in the runner's code. On each client repo:
Settings → Branches → add a rule for the default branch that requires a pull
request before merging. Then even a mistake in the runner cannot change the
live site.

## 8. The runner's key and config

On the phone: Setup → Runner key → Make key → Copy. It is shown once. It can
only claim a run, check in, finish and upload a picture.

As `cliphy-runner`:

```sh
mkdir -p ~/.cliphy-runner && chmod 700 ~/.cliphy-runner
cat > ~/.cliphy-runner/config.json <<'JSON'
{
  "apiUrl": "https://api.cliphy.app",
  "apiKey": "cliphy_sk_…",
  "workUser": "cliphy-work",
  "workRoot": "/srv/cliphy/work",
  "reposRoot": "/srv/cliphy/repos"
}
JSON
chmod 600 ~/.cliphy-runner/config.json
```

## 9. Check

```sh
cd ~/cliphy && pnpm --filter cliphy-runner check
```

Success: every line starts with `ok`. A `FAIL` line says what to do.

## 10. Keep it running

As `cliphy-runner`, `~/.config/systemd/user/cliphy-runner.service`:

```ini
[Unit]
Description=Cliphy website task runner
After=network-online.target

[Service]
WorkingDirectory=%h/cliphy
ExecStart=/usr/bin/env pnpm --filter cliphy-runner start
Restart=always
RestartSec=10

[Install]
WantedBy=default.target
```

```sh
systemctl --user daemon-reload
systemctl --user enable --now cliphy-runner
sudo loginctl enable-linger cliphy-runner   # as admin: keeps it running when nobody is logged in
```

Success: `journalctl --user -u cliphy-runner -f` shows "Runner started."

To update: `cd ~/cliphy && git pull && pnpm install && systemctl --user restart cliphy-runner`.

## 11. Add a repo

1. Make sure the repo is in the token from step 6 and protected as in step 7.
2. On the phone, open the project and fill in **Website repo** (`owner/name`)
   and **Live site** (`https://…`).

From then on, a confirmed request with work in that project offers **Start on
the site** in Chat and on the task's page.

## What the runner will never do

Push to a default branch, merge, deploy, or put a client's messages in a pull
request. It works only on branches named `cliphy/…` and opens draft pull
requests.
