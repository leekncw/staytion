# STAYtion — running it on your own computer

This is a real, working version of STAYtion. Accounts, posts, likes,
follows, messages, notifications, news, and moderator/verification tools
all actually save and work — not a mockup anymore.

**Lives is still a visual preview only.** Real live streaming needs a
whole separate video/broadcast system, so that page isn't wired up yet.

Everything runs entirely on your own computer. Nothing is uploaded
anywhere, and nobody outside your computer can see it unless you
specifically set that up later.

---

## 1. Install Node.js (one-time setup)

STAYtion runs on something called Node.js. If you don't already have it:

1. Go to **https://nodejs.org**
2. Download the button that says **"LTS"** (Long Term Support) — that's the
   safe, recommended version.
3. Open the file you downloaded and click through the installer with the
   default options.
4. Restart your computer if it asks you to.

To check it worked: open your computer's terminal
(**Terminal** on Mac, **Command Prompt** or **PowerShell** on Windows) and type:

```
node -v
```

If it prints something like `v22.x.x`, you're good.

---

## 2. Set up STAYtion (one-time per copy of this folder)

1. Unzip this folder somewhere you'll remember, like your Desktop.
2. Open your terminal.
3. Move into the folder. For example, if it's on your Desktop:

   **Mac:**
   ```
   cd ~/Desktop/staytion-app
   ```
   **Windows:**
   ```
   cd Desktop\staytion-app
   ```
4. Install STAYtion's dependencies (this downloads the small pieces of
   code it needs to run):

   ```
   npm install
   ```

   This only needs to be done once. It'll take a minute or two.

---

## 3. Run STAYtion

Every time you want to use it:

1. Open your terminal in the `staytion-app` folder (same `cd` step as above).
2. Run:

   ```
   npm start
   ```
3. You'll see:

   ```
   STAYtion is running: http://localhost:3000
   ```
4. Open that link (`http://localhost:3000`) in your browser (Chrome, Safari, etc).

To stop the server, click back into the terminal window and press `Ctrl + C`.

---

## 4. Testing it out with more than one account

Since messages and follows are more fun with two people:

- Sign up for one account in a normal browser window.
- Open an **incognito / private window** (or a different browser) and sign
  up for a second account there.
- Now you can follow, message, and like between the two, just like two
  real people would.

**The very first account anyone creates automatically becomes the "Owner"** —
that account can post official News updates, grant verified badges, and
promote other accounts to Moderator (who can also grant verification).
Every account after that starts as a regular member.

---

## 5. Your data

All accounts, posts, and messages are saved in a file at:

```
data/db.json
```

- To wipe everything and start completely fresh, close the server and
  delete that file (or just delete everything inside the `data` folder).
  It'll be recreated automatically next time you run `npm start`.
- This file is just plain text (JSON) if you ever want to peek at it.

---

## 6. Putting STAYtion on the real internet for free

There's a real, no-cost way to do this — you just need two free accounts
instead of one, because free web hosts erase locally-saved files every
time your app restarts. To keep accounts/posts/photos safe, STAYtion can
optionally save everything to a free database instead of the local
`data/db.json` file. Nothing about your app changes — you just set one
extra setting when you deploy.

**Step 1 — Create a free database (MongoDB Atlas)**
1. Go to **https://www.mongodb.com/cloud/atlas/register** and sign up (no card required).
2. Create a cluster and choose the **M0 Free** tier.
3. Under **Database Access**, create a database user + password (save these).
4. Under **Network Access**, click **Add IP Address** → **Allow Access from Anywhere** (`0.0.0.0/0`) — needed since your host's IP isn't fixed.
5. Click **Connect** → **Drivers**, and copy the connection string. It looks like:
   ```
   mongodb+srv://youruser:yourpassword@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority
   ```

**Step 2 — Put the code on GitHub**
1. Create a free account at **https://github.com**.
2. Create a new repository and drag in the whole `staytion-app` folder (skip the `node_modules` folder — it's not needed).

**Step 3 — Deploy on Render's free tier**
1. Sign up at **https://render.com** (you can sign in with GitHub).
2. Click **New → Web Service**, pick your repo.
3. Build Command: `npm install` · Start Command: `npm start`.
4. Choose the **Free** instance type.
5. Under **Environment**, add these variables:
   - `MONGODB_URI` → paste your connection string from Step 1 (fill in your real password)
   - `SESSION_SECRET` → any long random string you make up
   - `NODE_ENV` → `production`
6. Click **Create Web Service**. Render gives you a free address like
   `staytion.onrender.com` with HTTPS already set up.

That's it — $0, and your data now lives in the database instead of on
Render's disk, so it survives restarts and redeploys.

**What "free" actually means here:**
- Render's free web service **spins down after 15 minutes of no visitors**
  and takes 30–60 seconds to wake back up on the next visit. Fine for a
  fan community that isn't getting constant traffic; not great if you
  want it always instantly loading.
- MongoDB's free tier gives you 512MB of storage — plenty for text
  posts/messages and a reasonable number of compressed profile photos,
  but not unlimited.
- `staytion.onrender.com` is a real, working, shareable address at no
  cost. A custom name like `staytion.com` instead of that subdomain
  isn't free anywhere — registrars charge roughly $10–20/year for a
  domain, since that's a fee to the domain registry itself, not a
  hosting cost. Render does support adding one for free once you own it
  (Settings → Custom Domains).
- If it ever outgrows the free tier (constant traffic, needing instant
  load with no spin-down), Render's paid tier starts around $7/month —
  no code changes needed, just flip the setting.

---

## A note on privacy/security

This is set up to be safe to run on your own computer or deploy as
described above. Standard caveats apply to any small hobby project: the
built-in login system is solid for a fan community but hasn't been
audited the way a bank's would be, so don't reuse a sensitive password
for it, and treat it as a fun community tool rather than a place to
store anything truly sensitive.

---

## What's real vs. still a preview

| Feature | Status |
|---|---|
| Sign up / log in | ✅ Real accounts, real passwords |
| Feed / posting / likes | ✅ Real, saved |
| Follows | ✅ Real |
| Messages | ✅ Real, updates instantly between open windows |
| Notifications | ✅ Real |
| News / announcements | ✅ Real (Owner/Moderator only can post) |
| Verification badges | ✅ Real (Owner/Moderator can grant) |
| Moderator roles | ✅ Real (Owner can promote/demote) |
| Search | ✅ Real (searches real accounts + real trending hashtags) |
| Profile pictures & banners | ✅ Real, uploadable from your own profile |
| Lives | 🚧 Still a visual preview — no real streaming yet |

---

## What's real vs. still a preview
