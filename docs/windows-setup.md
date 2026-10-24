# Set up Aiden on Windows

This guide walks you through setting up Aiden on a Windows computer, one step at a time. You don't need any technical background. Plan for about 30 minutes.

## What you need

- A Windows computer you can install apps on. On a work computer, IT may need to help.
- A **paid ChatGPT plan** or a **paid Claude plan**. Aiden uses your plan to do its work. It does not come with its own.
- A **GitHub account** that can see your project's code. If you're not sure, ask your engineering lead.

## What you'll do

1. Install Aiden.
2. Connect Aiden to ChatGPT or Claude.
3. Connect Aiden to GitHub.
4. Check that everything works.

Do the steps in this order.

## Before you start: how to run a command

A few steps ask you to type a short command into a window called **PowerShell**. You don't need to understand the commands. Just copy and paste them.

1. Click **Start** (the Windows button), type `PowerShell`, and open **Windows PowerShell**. A window with a dark background and some text opens.
2. Copy a command from this guide. Each one is in a gray box.
3. Click inside the PowerShell window and paste it: right-click, or press **Ctrl+V**.
4. Press **Enter**.
5. Wait until it finishes. You'll know it's done when a new line starting with `PS C:\` appears and you can type again.

Run only one command at a time. Some steps ask you to close PowerShell and open it again; this is normal and lets Windows find what you just installed.

## Step 1: Install Aiden

1. Go to the [Aiden download page](https://github.com/opheleon/aiden-preview/releases/latest).
2. Under **Assets**, click the file that ends in `-x64.exe` (for example, `Aiden-1.2.5-x64.exe`) to download it.
3. Open the downloaded file.
4. Windows may show a blue box saying **Windows protected your PC**. This appears because Aiden is a new app. Click **More info**, then **Run anyway**.
5. When it finishes, open Aiden to make sure it starts. Then close it. You'll come back to it later.

## Step 2: Connect Aiden to ChatGPT or Claude

Do **2A** if you use ChatGPT, or **2B** if you use Claude. If you use both, you can do both.

Having the ChatGPT or Claude app on your computer is not enough. Aiden needs a small helper tool that you install below.

### 2A: ChatGPT

**Install the helper (called Codex).** In PowerShell, run:

```powershell
irm https://chatgpt.com/codex/install.ps1 | iex
```

Close PowerShell and open it again.

**Check that it installed.** Run:

```powershell
codex.exe --version
```

You should see a version number. If you see an error instead, see [If something goes wrong](#if-something-goes-wrong).

**Sign in.** Run:

```powershell
codex.exe login
```

A browser window opens. Sign in with the ChatGPT account that has your paid plan. When the browser says you're done, go back to PowerShell.

**Check the sign-in.** Run:

```powershell
codex.exe login status
```

It should say **Logged in using ChatGPT**. If it mentions an API key instead, that is a different way of paying; ask for help before you continue.

**Connect it in Aiden.**

1. Open Aiden.
2. Go to **Settings → Model**.
3. Choose **Codex**.
4. Leave **Existing subscription** selected.
5. Click **Check connection**.

Aiden should say it's connected and show a list of models. Then go to Step 3.

### 2B: Claude

**Install the helper (called Claude Code).** In PowerShell, run:

```powershell
irm https://claude.ai/install.ps1 | iex
```

Close PowerShell and open it again.

**Check that it installed.** Run:

```powershell
claude.exe --version
```

You should see a version number. If you see an error instead, see [If something goes wrong](#if-something-goes-wrong).

**Sign in.** Run:

```powershell
claude.exe auth login --claudeai
```

A browser window opens. Sign in with the Claude account that has your paid plan. If the browser shows you a code, copy it, paste it into the PowerShell window, and press **Enter**. Never paste this code anywhere else.

**Check the sign-in.** Run:

```powershell
claude.exe auth status --json
```

Look for these three lines:

- `"loggedIn": true`
- `"authMethod": "claude.ai"`
- `"subscriptionType"` followed by your plan name, such as `"pro"` or `"max"`

This output includes your account details, so don't post it publicly.

**Connect it in Aiden.**

1. Close Aiden completely, then open it again.
2. Go to **Settings → Model**.
3. Choose **Claude**.
4. Leave **Existing subscription** selected.
5. Click **Check connection**.

Aiden should say it's connected and show a list of models.

On Windows, the **Sign in with Claude** button in Aiden doesn't work yet. Use the PowerShell steps above instead, then click **Check connection**.

## Step 3: Connect Aiden to GitHub

GitHub is where your team's code lives. Aiden reads the code to see how the work is going. It never changes your code.

You'll install two small tools: **Git**, which downloads code, and **GitHub CLI**, which signs you in.

**Install them.** In PowerShell, run this first command and wait for it to finish:

```powershell
winget install --id Git.Git -e --source winget
```

Then run this one:

```powershell
winget install --id GitHub.cli -e --source winget
```

If Windows asks whether to allow changes, click **Yes**. If PowerShell says `winget` is not recognized, see [If something goes wrong](#if-something-goes-wrong).

Close PowerShell and open it again.

**Check that they installed.** Run:

```powershell
git --version
```

Then run:

```powershell
gh --version
```

Each should show a version number.

**Sign in to GitHub.** Run:

```powershell
gh auth login --hostname github.com --git-protocol https --web
```

Then:

1. If it asks **Authenticate Git with your GitHub credentials?**, press **Enter** to choose Yes.
2. It shows a one-time code made of letters and numbers, such as `ABCD-1234`. Write it down or copy it.
3. Press **Enter** to open your browser.
4. In the browser, sign in to GitHub if asked, type in the code, and click **Authorize**.
5. Go back to PowerShell and wait until it says **Logged in as** followed by your GitHub username. Don't close the window before then.

**Finish the setup.** Run:

```powershell
gh auth setup-git --hostname github.com
```

**Check the sign-in.** Run:

```powershell
gh auth status --hostname github.com
```

It should say you're logged in to github.com.

## Step 4: Check that everything works

1. Close Aiden completely, then open it again.
2. Go to **Settings → Model** and make sure your choice from Step 2 says it's connected.
3. Start a project. In the project's chat, Aiden asks about your code. Tell it the name of your code repository, written like `your-company/your-app`. Ask your engineering lead if you don't know it.
4. Aiden should find the repository and connect it.

That's it. You're set up when Aiden shows your AI provider as connected and can find your repository.

Using Aiden counts toward your ChatGPT or Claude plan's usage limits.

## If something goes wrong

Keep the PowerShell window open so you can see the message. Then check the list below.

- **PowerShell says a command "is not recognized".** Close PowerShell, open it again, and try once more. If it still fails, close Aiden, sign out of Windows, sign back in, and try again.
- **Aiden says ChatGPT (Codex) isn't connected.** Make sure `codex.exe --version` shows a version number. Then close Aiden completely and open it again.
- **Aiden says Claude isn't connected.** Do the sign-in in Step 2B again, then click **Check connection**. Don't rely on the **Sign in with Claude** button on Windows.
- **Claude says Git Bash is missing.** Do the Git install at the start of Step 3, then try the Claude sign-in again.
- **PowerShell says `winget` is not recognized.** Download and run the [Git installer](https://git-scm.com/install/windows) and the [GitHub CLI installer](https://cli.github.com) instead, keeping the default options. Then continue with "Check that they installed."
- **GitHub says "success" in the browser, but PowerShell is still waiting.** Make sure you typed the code PowerShell is showing now, not one from an earlier try. If the code expired, run the sign-in command again to get a new one.
- **Aiden can't find your repository.** Open [github.com](https://github.com) in your browser, signed in as the same account, and check you can see the repository. If you can't, ask your engineering lead for access. Some companies also need an admin to approve GitHub CLI.
- **Your work computer blocks an install.** Ask IT to install the tool for you, and share this guide with them.

**Still stuck?** Ask in the [Aiden Slack community](https://join.slack.com/t/aidenbyopheleon/shared_invite/zt-4apsg5d7p-FDO9ae0imxj~KgauP8lpsw). Include:

- Your Aiden version.
- The step you were on.
- The command you ran.
- The exact message you saw. A screenshot works.

Never share passwords, sign-in codes, or the full output of `claude.exe auth status --json`.

For other problems, see [troubleshooting](troubleshooting.md).

## Let an AI assistant help

If you have an AI assistant that can work on your computer, such as Claude Code or Codex, you can ask it to walk you through this guide. Copy this message into it:

> Help me follow Aiden's Windows setup guide. Detect existing native tools and reuse working sign-ins. Set up my selected ChatGPT or Claude subscription first, and GitHub last. Use the vendors' official installers for missing tools. Keep Existing subscription selected and do not switch to API-key billing. Let me complete browser approvals and enter any requested codes directly into the waiting terminal; never ask for credentials or codes in chat. Verify each provider inside Aiden and read-only access to the repository I name. Do not start paid model work or modify remote repositories as part of setup. Report each connection as working, awaiting my action, or blocked, with the exact next step.

You still do the browser sign-ins yourself. If the assistant can't save the GitHub sign-in, run that step in your own PowerShell window.

## Details for IT

- The installer is unsigned. To verify it, download `SHA256SUMS.txt` from the same release and compare its line for the installer with the output of `Get-FileHash .\Aiden-VERSION-x64.exe -Algorithm SHA256`.
- Aiden needs the Codex CLI or Claude Code on the user's `PATH`, plus Git and GitHub CLI. The Codex and Claude installers normally place their tools in the user's `.local\bin` folder.
- Aiden uses the user's existing subscription sign-in and never switches to API-key billing on its own.
- Organizations that require SSO may need to authorize GitHub CLI for the user's account.
- Official references: [Codex CLI](https://learn.chatgpt.com/docs/codex/cli), [Claude Code setup](https://code.claude.com/docs/en/setup), and [GitHub CLI login](https://cli.github.com/manual/gh_auth_login).
