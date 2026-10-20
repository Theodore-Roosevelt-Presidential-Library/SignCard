# SignCard

A reusable "sign the card" tool for the Theodore Roosevelt Presidential Library. Visitors watch an opening, sign a card with a message, then see the best messages, a map of where people signed from, and a call to action. The first campaign is Theodore Roosevelt's birthday card (October 27).

- Card: https://card.labs.trlibrary.com/ (or `?c=<campaign-id>`)
- Builder: https://card.labs.trlibrary.com/builder/
- Starter signing (skips the opening, for staff before launch): `?c=<campaign-id>&starter=1`

## How it works

```
Visitor's browser ──create only──▶ Firestore  signatures/<sha256(campaign|email)>
                                         │
GitHub Action, every 10 min ◀────────────┘  (service account)
  · OpenAI moderation + gpt-4.1-mini review: names, approval, feature score
  · private running totals in Firestore  aggregates/<campaign>
  · public numbers in data/<campaign>.json  → commit → redeploy Pages
                                         │
Card page ◀── data/<campaign>.json (totals, featured messages, first names + last initial, city, ZIP-level dots)
```

- Browsers can only create a signature (`firebase/firestore.rules`). Nobody can read signatures from a browser.
- One signature per email per campaign: the document ID is a hash of campaign + email.
- Emails, full last names and ZIP codes never leave Firestore. The public file holds first name + last initial, city/state, approved messages and ZIP-centroid dots.
- If OpenAI is down, nothing is approved; signatures wait and are retried.

## Campaigns

Each campaign is one file in `campaigns/`. The builder produces it; it goes live when the file is committed (GitHub write access is the gate). `campaigns/index.json` sets the default campaign for the bare URL and the builder's templates.

Moderation by hand: every featured message in `data/<id>.json` has an `id`. Add it to `moderation.hide` in the campaign file to remove it, or to `moderation.pin` to keep it at the front. The next run (within 10 minutes) applies it.

## Embedding

```html
<div data-signcard="tr-birthday-2026"></div>
<script src="https://card.labs.trlibrary.com/embed.js" async></script>
```

The iframe resizes itself, scrolls the host page as the visitor moves through the card, may use the microphone (blowing out the candles) only after the visitor allows it, and pushes `signcard_signed` to the host page's `dataLayer`.

## Setup

1. **Firebase** (project under matt@trlibrary.com): create a Firestore database, publish `firebase/firestore.rules`, register a web app and put its `projectId` and `apiKey` in `assets/js/config.js`.
2. **Google sign-in for the Action**: trlibrary.com blocks service account keys, so the Action uses Workload Identity Federation instead. Run `firebase/setup-wif.sh` once in Google Cloud Shell for trpl-signcard. Only this repository can use the resulting sign-in.
   **Repository secret** (Settings → Secrets and variables → Actions): `OPENAI_KEY`, an OpenAI API key (same name as the Reviews repo).
3. **Pages**: Settings → Pages → Source: GitHub Actions. Custom domain `card.labs.trlibrary.com` (CNAME record to `theodore-roosevelt-presidential-library.github.io`).

Run the processor locally:

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r scripts/requirements.txt
FIREBASE_SERVICE_ACCOUNT="$(cat key.json)" OPENAI_KEY=sk-... python3 scripts/process_signatures.py --dry-run
```

## Credits

- Theodore Roosevelt in buckskin, 1885. Library of Congress, Prints & Photographs Division, LC-USZ62-23232 (public domain).
- Badlands view: National Park Service, via Wikimedia Commons (public domain).
- ZIP code centroids: GeoNames (CC BY 4.0), `scripts/zips.json.gz`.
- US states: us-atlas (ISC), `assets/data/us-states.json`.
- Fonts are served from trlibrary.com (Dharma Gothic E, Clearface, Frutiger) and Google Fonts (Mrs Saint Delafield).
