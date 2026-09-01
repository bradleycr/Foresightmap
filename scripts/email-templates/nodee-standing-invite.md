# Standing Nodee join invite (onboarding)

Reusable join URL for newly onboarded **Berlin / SF Nodees** who are **not
yet on the Atlas sheet**. Anyone with the link can create a Nodee profile
until the token expires — it is **not** one-time.

Do **not** paste the live URL into this file (public repo). Mint a fresh one:

```bash
pnpm invite:link -- --role Nodee --days 365 --base https://atlas.foresight.org
```

Paste the printed URL into `{{Join link}}` below, then copy this into a
Google Doc (or send as email). Rotate if the link leaks beyond Nodee
onboarding. People already on the roster should get a **claim** link instead
(`pnpm claim:links --role Nodee`).

---

## Subject

```
Welcome to the node — join The Foresight Atlas
```

## Body (paste into Google Docs / Gmail)

```
Hi,

Welcome to the Foresight node community.

We've built an internal tool for the network: The Foresight Atlas. It's a
living map and directory of our grantees, fellows, and node community
(Berlin, SF, Global), plus programming, RSVPs, and check-ins for node
events.

You're not on it yet — this standing invite is how new Nodees create a
profile. Use this link (it is for Nodees only):

{{Join link}}

What to do:
1. Open the link and fill in your name, city, and a short project line.
2. Role is already set to Nodee — you don't need to change it.
3. Set Primary node to Berlin Node or Bay Area Node if that's where you're
   based (use Global if you're not tied to either).
4. Choose a password (at least 8 characters), then submit.
5. Add a photo and links whenever you like — you can edit your profile any
   time after you sign in.

Once you're in, you can:
- Find yourself (and everyone else) on the map
- See Berlin, SF, and Global programming — and RSVP
- Check in when you're at a node in person

The same link works for other newly onboarded Nodees until it expires, so
you can keep it in this onboarding doc. If it ever stops working, reply and
we'll mint a fresh one.

Questions, or trouble creating an account? Just reply to this email.

Looking forward to seeing you on the map.

—
Foresight Institute
```

---

## Shorter variant

```
Subject: Join The Foresight Atlas (Nodee invite)

Hi,

Welcome to the node. The Foresight Atlas is our internal map + directory
for grantees, fellows, and Nodees, with programming, RSVPs, and check-ins.

Create your Nodee profile here:
{{Join link}}

Pick Berlin Node or Bay Area Node as your primary node, set a password,
and add your city so you show up on the map. You can edit everything later.

Questions? Reply to this email.
```
