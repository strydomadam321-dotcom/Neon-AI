# Run NEON AI on your own computer (Ubuntu Server)

This turns an old laptop into the NEON AI server. Your accounts and chats then live on that laptop, so there is no
30-day database expiry and nothing sleeps. Use **Ubuntu Server 24.04 LTS** (64-bit).

> **Before you start:** the installer can erase the laptop's disk. Back up anything you want to keep.

## 1. Install Ubuntu Server

Boot the laptop from the USB stick. You move around with the **arrow keys**, **Tab**, **Enter**, and **Space** to tick a box.

| Screen | What to pick |
|---|---|
| Language | English |
| Keyboard | the layout that matches your keyboard, then Done |
| Type of install | **Ubuntu Server** (not "minimized") |
| Network | leave it on automatic (DHCP). A cable is easiest; Wi-Fi works too: select it and type the password |
| Proxy / Mirror | leave as it is, Done |
| Storage | **Use an entire disk**, leave the rest as suggested, Done, then Continue (this erases the disk) |
| Profile | your name, a **server name** (for example `neonbox`), a **username** and a **password**. Write them down |
| Ubuntu Pro | Skip for now |
| SSH | **tick "Install OpenSSH server"** (Space). This lets you control the laptop from your other computer |
| Featured snaps | pick nothing, Done |

Wait for it to finish, choose **Reboot Now**, and pull the USB stick out when it says so.

## 2. First login and finding the laptop on your network

Log in on the laptop with the username and password you chose, then run:

```bash
hostname -I
```

That prints the laptop's address (something like `192.168.1.42`). From now on you can work from your other computer
(Windows PowerShell, macOS Terminal or Linux all have `ssh`):

```bash
ssh YOUR_USERNAME@192.168.1.42
```

## 3. Get the code onto the laptop

```bash
sudo apt update && sudo apt install -y git
```

```bash
git clone https://github.com/strydomadam321-dotcom/Neon-AI.git
```

If `git clone` asks for a username and password, the repository is private. Either create a read-only access token on
GitHub (Settings, Developer settings, Fine-grained tokens) and paste it as the password, or copy the folder from your
other computer instead: `scp -r Neon-AI YOUR_USERNAME@192.168.1.42:~`.

## 4. Run the setup

```bash
sudo bash Neon-AI/deploy/setup-ubuntu.sh
```

It asks for two things (press Enter to skip any):

- your **Anthropic API key**
- your **Gemini API key**

Then it installs everything, starts NEON AI, and prints the address to open, for example `http://192.168.1.42:3000`,
from any phone or computer on the same Wi-Fi.

You can preview it first with `sudo bash Neon-AI/deploy/setup-ubuntu.sh --dry-run` (changes nothing).

What it set up for you: Node.js, PostgreSQL, the app in `/opt/neon-ai` running as its own limited user, start on boot,
automatic restart if it crashes, a **nightly database backup** (14 kept in `/var/backups/neon-ai`), and "keep running with
the lid closed".

## 5. Using it away from home (optional)

Do **not** forward port 3000 on your router: the app speaks plain HTTP. Use one of these instead.

- **Tailscale** (easiest, private): `curl -fsSL https://tailscale.com/install.sh | sh`, then `sudo tailscale up` and open
  the link it prints. Install Tailscale on your phone and PC too. Then `http://neonbox:3000` works from anywhere, but only
  on your own devices.
- **Cloudflare Tunnel** (public address on your own domain): needs the domain's DNS to be on Cloudflare. Follow
  Cloudflare's "Create a tunnel" guide and point it at `http://localhost:3000`. Your domain currently points at Render, so
  this is a bigger switch. Ask me before doing it and I'll walk you through it.

## 6. Everyday commands

| I want to | Command |
|---|---|
| see the log | `sudo journalctl -u neon-ai -f` |
| restart it | `sudo systemctl restart neon-ai` |
| change a key | `sudo nano /etc/neon-ai.env`, then restart |
| update to new code | `cd ~/Neon-AI && git pull && sudo bash deploy/setup-ubuntu.sh` |
| check it is healthy | `curl http://localhost:3000/api/config` |
| make a backup right now | `sudo /usr/local/bin/neon-ai-backup` |

Your settings and data are kept when you run the setup again.

## 7. Restoring a backup

```bash
sudo systemctl stop neon-ai
```

```bash
sudo -u postgres pg_restore --clean --if-exists --no-owner --role=neonai -d neonai < /var/backups/neon-ai/neonai-DATE.dump
```

```bash
sudo systemctl start neon-ai
```

## 8. Bringing your chats over from Render (optional)

The accounts so far are test accounts, so starting fresh is fine. To keep them, **before the Render database expires on
2026-12-18**:

1. In the Render dashboard, open the `neon-ai-db` database, go to **Networking** and add your home internet's public IP
   (search "what is my IP"). Copy its **External Database URL**.
2. On the laptop:

```bash
sudo systemctl stop neon-ai
```

```bash
pg_dump -Fc "PASTE_THE_EXTERNAL_URL_HERE" > ~/render.dump
```

```bash
sudo -u postgres pg_restore --clean --if-exists --no-owner --role=neonai -d neonai < ~/render.dump
```

```bash
sudo systemctl start neon-ai
```

(`pg_dump` must be version 16 or newer, which is what Ubuntu 24.04 installs.) Remove your IP from Render afterwards.

## Good to know

- The laptop must stay on and connected, so leave it plugged in. A worn-out battery doesn't matter while it is on mains power.
- Ubuntu installs security updates automatically.
- If it shows "address already in use" or the page doesn't open, run `sudo journalctl -u neon-ai -n 50 --no-pager` and
  send me the last lines.
