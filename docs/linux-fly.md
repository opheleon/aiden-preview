# Run an Aiden Teams worker on Linux and Fly.io

Aiden can run on a Linux server with no desktop app as one more machine in your team. It signs in to Aiden Teams as you, asks the team what to do next, and does that work on your own Claude subscription, exactly like the desktop app does when **This machine** picks up team work. The server stays on, so team work keeps moving while your laptop is closed.

The repository includes a `Dockerfile` for the worker and a `fly.toml` for [Fly.io](https://fly.io). The image also runs on any Linux host with Docker.

## What it does and does not do

- It does **team work only**: writing requirements, code checks, estimates, coding tasks, and browser checks that your team's queue hands to it. You still create projects, review requirements, and answer questions in the desktop app or the Teams dashboard.
- It uses **Claude** with a paid Claude plan, **Codex** with a ChatGPT plan, or both. The team only sends it work for a model it is signed in to.
- It picks up work with the desktop defaults: pickup on, stopping at 70% of your plan's usage window.
- It never merges or deploys code, and it has no public address. It only makes outbound requests to Aiden Teams, Auth0, GitHub, Anthropic, and OpenAI.
- iPhone checks need a Mac, so the team gives them to other machines.

## What you need

- A member account in an Aiden Teams team.
- A **paid Claude plan**, a **ChatGPT plan with Codex**, or both. The worker counts against the same plan limits as your desktop.
- A **GitHub account** that can see the team's repositories.
- A [Fly.io account](https://fly.io/docs/getting-started/) and the [`fly` command](https://fly.io/docs/flyctl/install/), signed in with `fly auth login`.
- A checkout of this repository.

## Step 1: Create the app and its volume

Pick an app name that is unique on Fly.io, for example `dana-aiden-worker`. From the repository folder, run:

```sh
fly apps create dana-aiden-worker
fly volumes create aiden_data --app dana-aiden-worker --region iad --size 10
fly deploy --app dana-aiden-worker
```

The volume holds everything the worker keeps: sign-ins, project copies, and checkpoints. It must be in the same region as `primary_region` in `fly.toml` (`iad` unless you change it). The first deploy builds the image on Fly's builders and takes a few minutes.

To give the machine a clearer name in Teams, change `AIDEN_DEVICE_NAME` in `fly.toml` before deploying.

## Step 2: Sign in to Claude, Codex, or both

For Claude:

```sh
fly ssh console --app dana-aiden-worker --pty --user aiden -C "claude auth login --claudeai"
```

Open the link it prints in a browser on your own computer, sign in with your paid Claude account, and paste the code back into the terminal. Claude Code saves the sign-in on the volume.

For Codex:

```sh
fly ssh console --app dana-aiden-worker --pty --user aiden -C "codex login --device-auth"
```

It prints a link and a one-time code. Open the link on your own computer, sign in with your ChatGPT account, and enter the code. Codex saves the sign-in on the volume.

## Step 3: Sign in to GitHub

```sh
fly ssh console --app dana-aiden-worker --pty --user aiden -C "gh auth login --git-protocol https --web"
fly ssh console --app dana-aiden-worker --pty --user aiden -C "gh auth setup-git"
```

The first command shows a one-time code and a link; open the link on your computer and enter the code. Coding tasks commit with a Git identity, so set one too, replacing the name and address:

```sh
fly ssh console --app dana-aiden-worker --user aiden -C "git config --global user.name 'Dana Example'"
fly ssh console --app dana-aiden-worker --user aiden -C "git config --global user.email dana@example.com"
```

## Step 4: Sign in to Aiden Teams

```sh
fly ssh console --app dana-aiden-worker --pty -C "aiden sign-in"
```

1. Open the address it prints in a browser on your own computer and sign in with your Teams email.
2. After you sign in, the browser tries to open a page at `http://127.0.0.1:53682/...` and says it cannot connect. That is expected: the address is meant for the server, not your computer.
3. Copy the whole address from the browser's address bar and paste it into the terminal.

The command forwards that address to the worker and says **Signed in as** your email. Each sign-in link lasts five minutes; if it expires, run the command again for a new one. If your desktop Aiden app is open and also signing in to Teams at the same moment, finish one sign-in before starting the other.

## Step 5: Check that it works

```sh
fly ssh console --app dana-aiden-worker -C "aiden status"
fly logs --app dana-aiden-worker
```

`status` shows the machine name, the Teams sign-in, the current task, and the team's last answer, for example a hold because no work is waiting. In the desktop app, **Teams** in the sidebar lists the server among your machines. The worker reports Claude, Codex, GitHub, Git, and the browser as verified tools when each is installed and signed in, so the team only sends it work it can do.

## Update, stop, and remove

- **Update:** pull the latest repository and run `fly deploy --app dana-aiden-worker`. Sign-ins and projects stay on the volume.
- **Stop:** `fly machine stop` with the machine's ID from `fly machine list`. A running task saves its checkpoint first and the team can hand it out again.
- **Remove:** `fly apps destroy dana-aiden-worker` deletes the machine and its volume, including every sign-in on it. Sign out of the Claude and GitHub sessions from their own settings pages if you want them revoked right away.

Run one machine per volume. Each machine is its own Teams machine with its own sign-ins, so do not scale the app's machine count beyond one; create a second app for a second worker.

## Security

- The worker has no OS keychain, so it keeps the Teams sign-in and any integration credentials in owner-only files under `/data/home/.aiden/credentials` (`AIDEN_CREDENTIAL_STORE=file`). Claude Code and the GitHub CLI keep their own sign-ins in their usual files under `/data/home`. Fly.io encrypts volumes at rest.
- Anyone who can run `fly ssh console` on the app can read those files and act as you on this machine. Give Fly.io access to the app only to people you would hand your laptop to.
- The worker runs as the unprivileged `aiden` user. `aiden` switches to that user even from a root shell, so its files stay readable by the worker.
- Repositories are copied read-only for code checks, as on the desktop. See [trust boundaries](architecture.md#trust-boundaries).

## Run it from a terminal

The worker does not need Fly.io or Docker. On any computer with this repository, Node, Git, the GitHub CLI, and Claude Code signed in, run:

```sh
pnpm install --frozen-lockfile
pnpm cli serve
```

Leave that running, and in a second terminal run `pnpm cli sign-in`. It keeps picking up team work until you stop it with Ctrl+C. On a server with no OS keychain, start it with `AIDEN_CREDENTIAL_STORE=file pnpm cli serve` so the sign-in survives a restart. Do not run it alongside the desktop app on the same computer: both would use the same Aiden data folder.

## Run it elsewhere with Docker

```sh
docker build -t aiden-teams-worker .
docker run --init -d --name aiden-worker -e AIDEN_DEVICE_NAME="Build server" -v aiden-data:/data aiden-teams-worker
docker exec -it -u aiden aiden-worker claude auth login --claudeai
docker exec -it aiden-worker aiden sign-in
```

Sign in to GitHub the same way as in Step 3, with `docker exec -it -u aiden aiden-worker` in place of `fly ssh console`. Build with `--build-arg WITH_BROWSER=false` to leave out Chromium for a smaller image; the team then sends browser checks to other machines.

## Troubleshooting

- **`aiden sign-in` says the worker has not started.** Check `fly logs`. The first start after a deploy takes a few seconds.
- **The pasted address is refused.** Paste the address from the browser after signing in. It starts with `http://127.0.0.1:53682/oauth/callback` (or port 53683) and contains `state=`.
- **The team never assigns work.** Run `aiden status`. The last answer gives the team's reason, such as Claude or Codex not being signed in, the usage cap being reached, or the team's subscription having lapsed.
- **Claude says to sign in again.** Repeat Step 2. Claude subscription sign-ins can end when you sign out everywhere from claude.ai.
- **Codex says to sign in again.** Repeat the Codex command in Step 2.
