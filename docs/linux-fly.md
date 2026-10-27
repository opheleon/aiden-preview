# Run an Aiden Teams worker on Linux and Fly.io

Aiden can run on a Linux server with no desktop app as one more machine in your team. It signs in to Aiden Teams as you, asks the team what to do next, and does that work on your own Claude subscription, exactly like the desktop app does when **This machine** picks up team work. Team work keeps moving while your laptop is closed.

The repository includes a `Dockerfile` for the worker and a `fly.toml` for [Fly.io](https://fly.io). On Fly.io the machine sleeps when there is no team work and the team wakes it with a signed webhook when there is, so you pay for the minutes it works rather than for every hour of the day. The image also runs on any Linux host with Docker.

## What it does and does not do

- It does **team work only**: writing requirements, code checks, estimates, coding tasks, and browser checks that your team's queue hands to it. You still create projects, review requirements, and answer questions in the desktop app or the Teams dashboard.
- It uses **Claude** with a paid Claude plan. Codex is not installed in the image.
- It picks up work with the desktop defaults: pickup on, stopping at 70% of your plan's usage window.
- It never merges or deploys code. Its only public address is the wake address, which accepts nothing but signed wakes from Aiden Teams. Everything else is outbound requests to Aiden Teams, Auth0, GitHub, and Anthropic.
- iPhone checks need a Mac, so the team gives them to other machines.

## What you need

- A member account in an Aiden Teams team.
- A **paid Claude plan**. The worker counts against the same plan limits as your desktop.
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

The wake address is `https://dana-aiden-worker.fly.dev/wake`, so the app needs public IP addresses. The first deploy usually assigns them; check with `fly ips list --app dana-aiden-worker`, and if the list is empty run:

```sh
fly ips allocate-v4 --shared --app dana-aiden-worker
fly ips allocate-v6 --app dana-aiden-worker
```

To give the machine a clearer name in Teams, change `AIDEN_DEVICE_NAME` in `fly.toml` before deploying.

## Step 2: Sign in to Claude

```sh
fly ssh console --app dana-aiden-worker --pty --user aiden -C "claude auth login --claudeai"
```

Open the link it prints in a browser on your own computer, sign in with your paid Claude account, and paste the code back into the terminal. Claude Code saves the sign-in on the volume.

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

`status` shows the machine name, the Teams sign-in, the current task, the wake address, and the team's last answer, for example a hold because no work is waiting. In the desktop app, **Teams** in the sidebar lists the server among your machines. The worker reports Claude, GitHub, Git, and the browser as verified tools, so the team only sends it work it can do.

Once signed in, the log shows **The team wakes this machine at https://dana-aiden-worker.fly.dev/wake**. If it says the address could not be saved, the machine stays on; see Troubleshooting.

## How it sleeps and wakes

1. After 15 minutes with no team work (`AIDEN_IDLE_STOP_MINUTES` in `fly.toml`), the worker logs **Stopping until the team wakes this machine** and exits. Fly.io leaves the machine stopped, and a stopped machine costs only its volume.
2. When a teammate creates a project or task, or a task finishes, fails, or gets its answer, Aiden Teams checks which sleeping machines could do the waiting work, using each one's last report: its tools, connections, and the exact Claude plan it is signed in with. It posts a wake to each of those machines.
3. Fly's proxy starts the machine for that request. The worker checks the wake's signature and asks for work at once. Starting takes a few seconds.
4. Every 30 minutes, and after the morning check is queued, the team also wakes machines for any work still waiting, so a missed wake costs at most half an hour.

The worker never sleeps while a task runs, while the team has not accepted its wake address, or while it is signed out, so that you can sign it in. Each run picks a new signing key and registers it, and the team signs every wake with it, so a request from anyone else is refused; it can still start the machine, which then stops again after 15 quiet minutes. Wakes name only the machine, never a task, project, or person.

To keep the machine on all the time instead, delete the `AIDEN_IDLE_STOP_MINUTES` line from `fly.toml` and deploy again. In the desktop app, a sleeping server shows as offline until work wakes it.

## Update, stop, and remove

- **Wake it yourself:** open `https://dana-aiden-worker.fly.dev/` in a browser, or run `fly machine start` with the machine's ID from `fly machine list`. Do this before `fly ssh console`, which needs a running machine. It stops again after 15 quiet minutes.
- **Update:** pull the latest repository and run `fly deploy --app dana-aiden-worker`. Sign-ins and projects stay on the volume. A machine that was asleep stays asleep until the next wake.
- **Stop:** `fly machine stop` with the machine's ID from `fly machine list`. A running task saves its checkpoint first and the team can hand it out again. With wakes on, the next team work starts it again. To keep it stopped, delete the `[http_service]` section from `fly.toml` and deploy before you stop it.
- **Remove:** `fly apps destroy dana-aiden-worker` deletes the machine and its volume, including every sign-in on it. Sign out of the Claude and GitHub sessions from their own settings pages if you want them revoked right away.

Run one machine per volume. Each machine is its own Teams machine with its own sign-ins, so do not scale the app's machine count beyond one; create a second app for a second worker.

## Security

- The worker has no OS keychain, so it keeps the Teams sign-in and any integration credentials in owner-only files under `/data/home/.aiden/credentials` (`AIDEN_CREDENTIAL_STORE=file`). Claude Code and the GitHub CLI keep their own sign-ins in their usual files under `/data/home`. Fly.io encrypts volumes at rest.
- Anyone who can run `fly ssh console` on the app can read those files and act as you on this machine. Give Fly.io access to the app only to people you would hand your laptop to.
- The worker runs as the unprivileged `aiden` user. `aiden` switches to that user even from a root shell, so its files stay readable by the worker.
- Repositories are copied read-only for code checks, as on the desktop. See [trust boundaries](architecture.md#trust-boundaries).
- The wake listener accepts only `POST /wake` signed within the last five minutes with this run's key, for this machine. The key lives in memory and on the Teams server, never on the volume or in logs.

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

Outside Fly.io the worker stays on unless you give it a wake address: set `AIDEN_WAKE_PORT` to the port it listens on, `AIDEN_WAKE_URL` to the public `https://` address that reaches that port (on the default port, by name, not an IP address), and `AIDEN_IDLE_STOP_MINUTES`. Whatever restarts the container then has to start it again when a wake arrives, which is what Fly's proxy does.

## Troubleshooting

- **`aiden sign-in` says the worker has not started.** Check `fly logs`. The first start after a deploy takes a few seconds.
- **The pasted address is refused.** Paste the address from the browser after signing in. It starts with `http://127.0.0.1:53682/oauth/callback` (or port 53683) and contains `state=`.
- **The team never assigns work.** Run `aiden status`. The last answer gives the team's reason, such as Claude not being signed in, the usage cap being reached, or the team's subscription having lapsed.
- **Claude says to sign in again.** Repeat Step 2. Claude subscription sign-ins can end when you sign out everywhere from claude.ai.
- **The log says the wake address could not be saved, so it stays on.** The Teams server needs the update that accepts wake addresses, and the machine must have asked for work once; it tries again every minute. An address the team refuses must be public `https://` on the default port.
- **New work does not wake the machine.** Check that `https://dana-aiden-worker.fly.dev/` answers **Aiden Teams worker is awake** (the first visit may take a few seconds while it starts), and that `fly ips list` shows addresses. The team only wakes a machine whose last report says it can do the work, so a machine that lost its Claude or GitHub sign-in is not woken: start it yourself and run `aiden status`.
- **The machine keeps starting and stopping.** Something is reaching its address. Every start ends after 15 quiet minutes; to stop wakes entirely, remove `AIDEN_WAKE_PORT` from `fly.toml` and deploy.
