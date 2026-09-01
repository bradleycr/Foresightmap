# Claim-invite email template (Nodees & Grantees)

Sent from **Lydia** (Program Manager, Events & Fellowship) as a fun launch
announcement — not a routine admin email. Bulk-send after generating links:

```bash
pnpm claim:links --role Nodee --csv > nodees.csv
pnpm claim:links --role Grantee --csv > grantees.csv
```

Each row has **Full name, Title, Email, Claim link** — mail-merge tools (Gmail
Mail Merge, GMass, Google Sheets + Apps Script, Mailchimp, etc.) can map those
straight to the placeholders below. Placeholder names match the CSV headers
exactly so you can paste this into most merge tools with no renaming.

Links are **one-time**: they stop working once the person sets a password, so
it's safe to send to everyone, including people who already claimed (their
link will just no longer work — harmless).

---

## Subject

```
Some fun news — meet The Foresight Atlas 🗺️
```

## Body

```
Hi {{Full name}},

Fun news — we've built an internal tool for the Foresight community: The
Foresight Atlas. It's a living map and directory of our grantees, fellows,
and node community (Berlin, SF, Global), plus programming, RSVPs, and
check-ins for node events.

You're already on it! Set your password with this one-time link, just for
you:
{{Claim link}}

Once you're in, you can:
- Find yourself (and everyone else) on the map
- See what's happening at Berlin, SF, and Global programming — and RSVP
- Check in when you're at a node in person
- Edit your own city, project, links, and photo any time

One thing to know: to get everyone set up quickly, we pulled your name,
role, and project description from the Foresight website and other public
sources. If anything's off or missing — city, project title, links, focus
areas, anything at all — just sign in and update it directly on your
profile. Consider it yours to keep current from here.

Questions, or trouble signing in? Just reply to this email.

Excited for you to check it out!

Lydia
Foresight Institute
```

---

## Shorter variant (optional)

```
Subject: Meet The Foresight Atlas — you're already on it

Hi {{Full name}},

Fun news — we've launched an internal tool for the Foresight community: The
Foresight Atlas, a living map + directory of grantees, fellows, and our
nodes (Berlin, SF, Global), with programming, RSVPs, and check-ins.

You're already on it. Set your password with this one-time link:
{{Claim link}}

We pulled your info from the Foresight website to get you started — if
anything's off, just edit it yourself once you're signed in.

Reply if you hit any snags!

Lydia
```

---

## Notes

- Sender: **Lydia La Roux** (Program Manager, Events & Fellowship) — reads
  as a team launch, not an admin/IT notice.
- Prefer sending in small batches (not one giant blast) so replies/bounces
  are easy to track.
- If someone lost their link or it expired (claim links don't expire but do
  go dead once claimed), regenerate with:
  ```bash
  pnpm claim:links -- "Full Name"   # single person, or use --role / --csv above
  ```
- For an already-claimed member who forgot their password, use
  `pnpm reset:link -- "Full Name"` instead (see `docs/README.md`). That flow
  still routes replies to Bradley by default (`atlasPasswordResetMailto` in
  `src/utils/checkInAuth.ts`) — update `SUPPORT_EMAIL` there if Lydia should
  own resets going forward too.
