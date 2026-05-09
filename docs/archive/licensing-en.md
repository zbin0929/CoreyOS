# Licensing — offline-signed activation keys

Corey ships with a **license gate**: the production build refuses to
unlock until the user pastes a valid signed token. Tokens are
verified locally with an embedded ed25519 public key — no server,
no network, no SaaS subscription. You (the maintainer) hold the
private key and mint tokens by hand.

This is the right scheme for: small audience (≤ a few hundred
users), one-time pricing or per-seat licenses, **closed-source
binary distribution**.

This is the **wrong** scheme for: open-source builds (anyone can
fork the code and remove the check), large-scale SaaS, recurring
subscriptions with refunds and revocation. For those, swap this
out for a hosted license server (Keygen.sh, Lemon Squeezy, etc.).

---

## One-time setup

Generate the keypair on **your** machine. Do this once, ever; if
you regenerate it every license you've issued is invalidated.

```bash
cargo run --manifest-path src-tauri/Cargo.toml \
  --bin license_keygen -- ~/.corey-license
```

Output:

```
~/.corey-license/private.pem   ← keep secret; back up offline
~/.corey-license/public.pem    ← copy into source tree
```

Copy the public key into the source so it ships with every build:

```bash
cp ~/.corey-license/public.pem src-tauri/src/license/public_key.pem
```

Rebuild Corey. The gate is now anchored to your keypair.

> **Backup the private key.** If you lose it, you can never mint
> new licenses without rotating + re-issuing every existing one.
> Suggested: copy to an encrypted USB stick + a password manager
> attachment.

---

## Minting a license for a buyer

> **Every license is machine-bound by default.** The
> `scripts/mint-license.sh` wrapper enforces `--machine-id`; it
> refuses to sign without one. This is the strongest defence
> against "buyer forwards token to friends" — the friend's install
> has a different UUID and the gate rejects.
>
> If you really need a portable token (testing, internal use), call
> the Rust binary directly: `cargo run --bin mint_license -- --user
> X --expires Y` (no `--machine-id`).

### Step-by-step

1. **Buyer installs Corey, copies their machine id.** The
   activation modal shows it on first launch:
   ```
   This machine: 1f4d1e2c-9b8a-4d2c-bc01-7e8a09f1b6c4   [📋]
   ```
   Settings → License also displays it once activated, so they can
   copy it later for re-issues.
2. **Buyer sends you the id** (email / chat / whatever).
3. **You mint a bound license:**
   ```bash
   bash scripts/mint-license.sh alice@example.com \
     --machine-id 1f4d1e2c-9b8a-4d2c-bc01-7e8a09f1b6c4 \
     --expires 1y
   ```
   (The wrapper accepts friendly durations like `1y`, `6mo`, `30d`,
   plus explicit `YYYY-MM-DD` dates. Use `--perpetual` for no expiry.)
4. **Buyer pastes the token** — gate verifies the bound id matches
   the local one, unlocks the app.

If the buyer later tries the same token on a different install,
the gate shows a `WrongMachine` verdict + the new install's
machine id, prompting them to ask you for a re-issue.

### All flags

- `--user <id>` — buyer identifier. Required.
- `--expires <date>` — `YYYY-MM-DD` or RFC-3339. Omit for perpetual.
- `--features <a,b,c>` — capability tags. Reserved for future
  per-feature gating.
- `--machine-id <uuid>` — bind to a specific install. Omit for a
  portable license.
- `--key <path>` — private key PEM. Defaults to
  `~/.corey-license/private.pem`.

---

## What the user sees

**First launch (production build):**
A full-screen modal with a textarea and "Activate" button. They
paste the token, click activate. On success the modal disappears
and Corey unlocks.

**With a valid license:**
Settings → License shows `Licensed to`, `Issued`, `Expires`,
`Features`. A "Remove license" button wipes the on-disk file and
re-shows the gate on next launch.

**On expiry:**
Gate reappears with a "Your license expired on YYYY-MM-DD" banner
and the same activation textarea. They paste a renewed token.

**Dev builds (`cargo build` / `pnpm tauri:dev`):**
A small yellow banner at the top reading "DEV BUILD — license
check bypassed", with a "Hide" button. The full-screen gate never
appears, so the maintainer can develop without minting tokens.

---

## File format reference

A license token looks like:

```
eyJ1c2VyIjoiYWxpY2VAZXhhbXBsZS5jb20iLCJpc3N1ZWQiOiIyMDI2LTA0LTI3VDA0OjAwOjAwWiIsImV4cGlyZXMiOiIyMDI3LTA0LTI3In0.MEUCIQDNmkH...
```

Two parts joined by a `.`:

1. **Payload** — base64url-encoded JSON:
   ```json
   {
     "user": "alice@example.com",
     "issued": "2026-04-27T04:00:00Z",
     "expires": "2027-04-27",
     "features": []
   }
   ```
2. **Signature** — base64url-encoded ed25519 signature over the
   raw payload bytes (NOT over the base64 form).

The on-disk location is `<config_dir>/license.txt` where
`config_dir` matches `paths::config_dir()`. On macOS:
`~/Library/Application Support/com.caduceus.app/license.txt`.

---

## Revocation? Refunds?

There's no built-in revocation list. If you need to invalidate a
key (refund, breach, etc.) your options are:

1. **Rotate the keypair** — every license becomes invalid;
   re-issue tokens to all buyers in good standing. Painful for
   large user bases; fine for small ones.
2. **Wait for expiry** — if you used `--expires`, just don't mint
   a renewal.
3. **Outgrow this scheme** — once revocation matters more than
   minting friction, switch to Keygen.sh or similar. The
   `LicenseGate` component stays; you replace `verify_token` with
   an HTTP call to the SaaS provider.

---

## Threat model & limits

What this protects against:

- Casual sharing — a buyer giving the binary to a friend who
  doesn't have a license.
- Tampered payloads — users editing `expires` or `user` fields
  and re-distributing.
- Lost keys — past licenses don't somehow re-enable the app
  forever (assuming you used `--expires`).

What this does NOT protect against:

- A user with the binary + a debugger / patching tool can disable
  the check. The protection is "raise the bar above casual"; not
  "stop a determined cracker."
- Source-code leaks. If your repo goes public, anyone can rebuild
  the app with the check removed.
- Multi-machine sharing of one *portable* (no `--machine-id`) key.
  Mint with `--machine-id` to prevent this.
- A determined attacker who copies the buyer's whole `<config_dir>`
  (including `machine_id`) to another install. Pure software
  fingerprints can't stop that — full hardware fingerprinting
  (mac address, CPU id, motherboard serial) would reduce this but
  also brittle (RAM upgrade ≠ new machine, dual-boot ≠ new
  machine, etc.). The current scheme is "raise the bar above
  casual sharing"; if you need stronger guarantees you've outgrown
  the offline scheme — switch to a hosted license server.
