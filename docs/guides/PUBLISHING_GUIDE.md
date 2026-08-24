# Publishing Guide

This app deploys to **GitHub Pages**, not Netlify.

## App code

```
git push origin master
```

Auto-deploys to `barroindustries.github.io` (remote: `https://github.com/barroindustries/barroindustries.github.io.git`).
The current branch is `master`. There is no CI gate.

A custom domain is configured via the `CNAME` file at the repo root.

## Firestore rules / indexes / Cloud Functions

Not covered by `git push`. See the **Commands** section of `CLAUDE.md` for
`firebase deploy --only firestore` and the Cloud Functions deploy steps.

## Not Netlify

Older docs in this repo may reference Netlify or a client-side OAuth setup —
that architecture no longer exists. GitHub Pages + Firebase is current.
