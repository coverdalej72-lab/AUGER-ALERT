# Go Live — Taking Real A$29 Payments

A simple, print-friendly checklist for switching your Feed Withdrawal Timer from
**test payments** to **real money** in your own Stripe account.

---

## Before you start
- You need a Stripe account in your name/business.
- Right now the app runs on your **test** key — buyers can practise with test card
  `4242 4242 4242 4242` but no real money moves. That's on purpose until you go live.

---

## Part 1 — Get your Stripe account ready (one time)
1. Log in to the Stripe Dashboard.
2. Complete **business/identity verification** (Stripe asks for your details + bank).
3. Add your **bank account for payouts** (Settings → Payouts).
4. Wait until Stripe shows your account as **"Payments enabled"**. Real charges only
   work after this.

## Part 2 — Get your LIVE key
5. In the Stripe Dashboard, flip the top toggle from **Test mode** to **Live mode**.
6. Go to **Developers → API keys**.
7. If you ever pasted a live key into a chat or email, click **Roll key** first to
   get a fresh one only you hold.
8. Copy the **live secret key** — it starts with `sk_live_...`.
   ⚠️ Keep it private. Do not put it in chat, email, or the preview.

## Part 3 — Publish the app
9. Press **Publish / Deploy** (top-right of the builder).
10. Wait for the deploy to finish — you get your permanent web link (this is the link
    you share with growers and put in the QR code).

## Part 4 — Switch the deployed app to your live key
11. Open the **Deployment** panel → **Secret settings** (environment secrets).
12. Find the secret named **`STRIPE_API_KEY`**.
13. Change its value to your **`sk_live_...`** key from Part 2. Save.
14. **Redeploy** (free) so the change takes effect.
    - Note: this only changes the *deployed* app. Your preview keeps the test key, so
      you can keep testing safely.

## Part 4b — Turn on the payment webhook (recommended, 2 minutes)
This makes a buyer's pass unlock **even if they close the tab** right after paying.
15. In Stripe Dashboard (Live mode) → **Developers → Webhooks → Add endpoint**.
16. Endpoint URL: **`https://YOUR-DEPLOYED-LINK/api/webhook/stripe`**
    (use your permanent deployed link from Part 3).
17. Events to send: choose **`checkout.session.completed`**.
18. Save, then copy that endpoint's **Signing secret** (starts `whsec_...`).
19. Back in the Deployment **Secret settings**, add/set **`STRIPE_WEBHOOK_SECRET`** to
    that `whsec_...` value. Save and **redeploy**.
    - The app already handles this endpoint — you're just pointing Stripe at it.

## Part 5 — Test with ONE real payment
15. Open your deployed link, create a fresh account, go to the paywall.
16. Buy the A$29 season pass with a **real card** (charge yourself once).
17. Confirm:
    - You return to the app and access unlocks for 1 year.
    - The payment shows in **Stripe Dashboard → Payments (Live mode)**.
18. If you want, refund yourself that test charge from the Stripe Dashboard.

## Part 6 — You're live 🎉
- Share your deployed link / QR with growers.
- Each buyer pays A$29 once and gets their own private Control Centre for a year.
- Money lands in your Stripe account and pays out to your bank on Stripe's schedule.

---

## Good to know
- **A$29 is a one-time season pass**, not an auto-renewing subscription. Buyers won't be
  charged again automatically.
- **Test vs live are separate.** Test buyers/passes don't carry over — that's normal.
- **If you change any code later**, just redeploy (free) so the live app updates.
- **Optional upgrade — payment webhook:** today the pass unlocks when the buyer returns
  to the app after paying. Adding a Stripe webhook makes it unlock even if they close the
  tab before returning. Ask me to add this any time.

## If something goes wrong
- "Still charging in test / not real money" → the deployed `STRIPE_API_KEY` is still the
  test key. Redo Part 4 and redeploy.
- "Card declined on my real card" → your Stripe account isn't fully "Payments enabled"
  yet (finish Part 1).
- "Buyer paid but didn't unlock" → have them reopen the app link; if it keeps happening,
  ask me to add the payment webhook (Part-6 note).
