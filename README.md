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

## Landscape mode (America the Beautiful)

A campaign with `"mode": "landscape"` (see `campaigns/atb-landscape-2026.json`) is a group photo mosaic instead of a card. People scan a QR code, name a place they hope is still protected 100 years from now, and each approved answer becomes one card-shaped tile on a big screen. A dim copy of the photo (`landscape.image`) shows the picture to complete; each tile reveals its patch of the photo in full color, in random order, with the place printed on it. At `landscape.goal` answers the picture is complete; past that the tiles get smaller so everyone fits.

**Builder.** Pick "Blank photo mosaic" (or copy an existing mosaic) under Start from. The mosaic gets its own steps (Mosaic, Phone, After adding) and the preview switches between the big screen and the phone. Publish gives the rehearsal, screen and phone links.

The picture appears only through filled tiles: empty cells show as a faint grid, and each approved answer reveals its patch of the photo.

To change the photo, add a wide image to `assets/img/` (at least 1600 pixels across; it is cropped to the screen from the center) and set `landscape.image` and `landscape.imageCredit`.

- Phone form: `?c=atb-landscape-2026` (the QR code adds `&src=qr`, saved in `source`)
- Big screen: `?c=atb-landscape-2026&display=1`. Open it in Edge on the Surface Hub and click **Full screen** (bottom right; move the pointer to show it). Tap any tile to read it.
- Rehearsal: add `&demo=1` for sample answers (a DEMO badge shows; `&fill=0.9` sets how full). `&goal=150` overrides the tiles in a full landscape.

Same signature fields as every campaign: the place goes in `message`. Screening works the same way (OpenAI moderation, then the review model, which also returns a short `label` printed on the tile). Nothing reaches the screen until it is approved; hide a tile by adding its `id` to `moderation.hide`.

**Instant tiles.** When someone submits, their phone also writes a marker with no content (`pending/<id>`: campaign and time). The display polls those every 4 seconds and lights up the new tile at once, photo only. The answer and name appear once the AI screening approves it; a tile not approved within 4 minutes goes away. The processor deletes each marker when it screens the signature.

**Spam checks never drop an entry.** A filled hidden field or a too-fast submit is noted in `source` (`:hp`, `:fast`) and the entry still goes to the screening. (Phone autofill can fill hidden fields, which used to make an entry vanish silently.)

**Speed.** During `live.hours` (Mountain Time) on open days, each scheduled run stays on for `SIGNCARD_LIVE_MINUTES` (9) and checks for new answers every 15 seconds, then writes the public numbers to `live/<campaign>` in Firestore. The display reads that document every 8 seconds, so a tile appears about 20–40 seconds after someone submits. This needs the `live/{campaign}` and `pending/{id}` rules in `firebase/firestore.rules` published once (`firebase deploy --only firestore:rules`). Without it the display falls back to `data/<campaign>.json`, which updates every 10–15 minutes.

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
gcloud auth application-default login   # once, as an account with Firestore access
OPENAI_KEY=sk-... python3 scripts/process_signatures.py --dry-run
```

## Credits

- Theodore Roosevelt in buckskin, 1885. Library of Congress, Prints & Photographs Division, LC-USZ62-23232 (public domain).
- Badlands view: National Park Service, via Wikimedia Commons (public domain).
- America the Beautiful logo: from the film's partner media kit.
- QR codes: qrcode-generator (MIT), loaded from cdnjs.
- ZIP code centroids: GeoNames (CC BY 4.0), `scripts/zips.json.gz`.
- US states: us-atlas (ISC), `assets/data/us-states.json`.
- Fonts are served from trlibrary.com (Dharma Gothic E, Clearface, Frutiger) and Google Fonts (Mrs Saint Delafield).
