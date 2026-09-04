# Standing community join invite (onboarding)

Reusable `/join` URL for mixed arrivals: Nodees, Fellows, Grantees, Prize
Winners. Anyone with the link can **claim an existing unclaimed row** (name +
roster email) or **create a new profile**. It is not one-time.

Do **not** paste the live URL into this file (public repo). Mint a long-lived
open invite (no `--role` lock):

```bash
pnpm invite:link -- --days 3650 --base https://atlas.foresight.org
```

A `--role Nodee` lock is only for Nodee-only packets. Staff (Foresight Team,
Senior Fellow) cannot self-claim or self-create from this link.

Rotate if the URL leaks beyond onboarding.

---

## Subject

```
Join The Foresight Atlas
```

## Body

```
Hi,

Welcome to the Foresight community.

The Foresight Atlas is our internal map and directory — grantees, fellows,
nodees, and programming (Berlin, SF, Global), plus RSVPs and check-ins.

Use this standing invite (keep it in this onboarding doc):

{{Join link}}

Search for your name first — especially if you're an alum; we may already
have you. Confirm with the email on file, then set a password.

If you don't find yourself, set up a new profile (name, role, password).
You can add city and the rest after you join.

If we don't have an email on your row, or the name search misses you, reply
to this email and we'll send a personal claim link.

Looking forward to seeing you on the map.

—
Foresight Institute
```
