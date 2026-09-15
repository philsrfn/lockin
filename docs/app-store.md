# The App Store listing

Everything App Store Connect asks for, written down once, so the next version
is a copy rather than an evening. Store copy is in German and English; the
prose around it is not store copy.

Written for **1.0, free, no in-app purchases** (15 September 2026). When
StoreKit ships, the description, the review notes and the App Privacy answers
all change — see the end.

---

## Before pressing "Submit for Review"

These are not text fields, and each one has sunk a submission somewhere:

- [ ] **`SIGNUP_MODE=open` is deployed.** With `invite`, a reviewer who signs in
      with Apple lands on "waiting to be let in", and that is a rejection
      under 2.1 before anybody looks at the app.
- [ ] **The privacy notice, the support page and the consent bump are
      deployed** — the URLs below have to open when the reviewer taps them.
- [ ] **A contact address on the support page** (`server/legal/support.de.md`).
      There is none yet.
- [ ] **Trader status** (App Store Connect → Business). Required under the EU
      Digital Services Act before the app can be distributed in the EU; a
      trader's address, phone and email are shown on the listing.
- [ ] **Build 21 or later** attached to the version. Build 20 still says
      "Trial — 30 days left", which is the 3.1.1 rejection this version avoids.
- [ ] **Screenshots**: 6.9" (1320 × 2868), at least three, from the simulator
      with the demo athlete — never a real account.

---

## App information

| Field | Value |
|---|---|
| Primary category | Health & Fitness |
| Secondary category | — (Food & Drink fits, but a second category earns nothing) |
| Content rights | Yes, it accesses third-party content: product data from OpenFoodFacts, under the ODbL |
| Age rating | see below |
| Privacy policy URL | `https://139-59-146-230.sslip.io/privacy` |
| Support URL | `https://139-59-146-230.sslip.io/support` |
| Marketing URL | — |
| Copyright | 2026 dotSpiro Tamm Pagel Serafin Mehes Le GbR |
| Price | Free |
| Encryption | Nothing to answer — `ITSAppUsesNonExemptEncryption` is `false` in `app.json` |

The sslip.io host is a decision for tonight, not for good: it works, and it
looks like what it is. Moving to a real domain is DNS, `LOCKIN_DOMAIN`, the
EAS variable `EXPO_PUBLIC_API_URL`, and a build.

---

## Store copy — Deutsch

**Untertitel** (max. 30)

```
Dein KI-Personal-Trainer
```

**Werbetext** (max. 170, änderbar ohne Review)

```
Training, Ernährung und Gewicht an einem Ort – mit einem Trainer, der deine Geschichte kennt und deinen Plan wirklich anpasst, statt nur zu antworten.
```

**Beschreibung**

```
lockin ist ein Personal Trainer in einer App. Er kennt dein Training, deinen Körper, deine Orte und deine Ernährungsregeln – und wenn sich etwas ändert, ändert er deinen Plan, statt dir nur zuzustimmen.

TRAINING
• Jede Einheit mit den Gewichten, die heute dran sind – berechnet aus deiner Historie, nicht geraten
• Logger für eine Hand, zwischen zwei Sätzen: Satz antippen, Pause läuft, fertig
• Funktioniert auch ohne Empfang im Keller-Gym
• Übungen tauschen, wenn ein Gerät belegt ist, oder frei trainieren
• Nach jeder Einheit eine kurze Auswertung: was besser war als letztes Mal

ERNÄHRUNG
• Mahlzeit fotografieren, Barcode scannen oder in einem Satz beschreiben
• Protein und Kalorien für den Rest des Tages auf einen Blick
• Deine eigenen Regeln, zum Beispiel „Frühstück ist immer Skyr“ – und der Trainer hält sich daran

GEWICHT & FORTSCHRITT
• Wiegen in drei Sekunden, der 7-Tage-Schnitt statt Tagesschwankungen
• Kraftwerte über die Zeit und was du tatsächlich verbrauchst
• Jeden Sonntag ein Wochenrückblick mit einer konkreten Änderung

DER TRAINER
• Schreib ihm wie einem Menschen: „Ich bin diese Woche in München“, „Das Knie zwickt“
• Er ändert Plan, Ziele und Übungen – und zeigt, was er geändert hat
• Sicherheitsgrenzen für Kalorien, Protein und Abnehmtempo sind fest eingebaut und lassen sich nicht wegreden

DATENSCHUTZ
• Keine Werbung, kein Tracking, kein Verkauf von Daten
• Fotos werden nicht gespeichert
• Alles exportieren oder löschen, direkt in der App
• Apple Health ist optional

lockin gibt Trainings- und Ernährungsempfehlungen, keine medizinische Beratung.
```

**Schlüsselwörter** (max. 100)

```
fitness,krafttraining,trainingsplan,kalorien,protein,abnehmen,gym,workout,ernährung,coach,gewicht
```

---

## Store copy — English

**Subtitle** (max 30)

```
Your AI personal trainer
```

**Promotional text** (max 170)

```
Training, food and weight in one place – with a trainer who knows your history and actually changes your plan instead of just replying.
```

**Description**

```
lockin is a personal trainer in an app. It knows your training, your body, the places you train and your food rules – and when something changes, it changes your plan instead of just agreeing with you.

TRAINING
• Every session with today's weights, worked out from your history rather than guessed
• A one-handed logger for between sets: tap the set, the rest timer starts
• Works with no signal in a basement gym
• Swap an exercise when the machine is taken, or train freely
• A short write-up after every session: what went better than last time

FOOD
• Photograph a meal, scan a barcode, or describe it in a sentence
• Protein and calories left for today at a glance
• Your own rules, like "breakfast is always skyr" – and the trainer keeps to them

WEIGHT & PROGRESS
• Weigh in in three seconds; the 7-day average instead of daily noise
• Strength over time, and what you actually burn
• A weekly review every Sunday with one concrete change

THE TRAINER
• Talk to it like a person: "I'm in Munich this week", "my knee hurts"
• It changes your plan, targets and exercises – and shows what it changed
• Safety limits for calories, protein and rate of loss are built in and cannot be talked around

PRIVACY
• No ads, no tracking, no selling data
• Photos are never stored
• Export or delete everything from inside the app
• Apple Health is optional

lockin gives training and nutrition guidance, not medical advice.
```

**Keywords** (max 100)

```
fitness,strength,workout,gym,calories,protein,macros,weight loss,coach,training,log
```

---

## App Review information

**Sign-in required:** yes, but **no demo account** — Sign in with Apple creates
an account on the spot (once `SIGNUP_MODE=open` is deployed).

**Notes** (English, for the reviewer)

```
lockin is an AI personal trainer for strength training and nutrition.

SIGN IN: Sign in with Apple creates an account immediately. There is no separate registration and no demo account is needed.

FIRST RUN: A consent screen explains that training, body and optional Apple Health data are processed, and that messages, that data and photos of food are sent to Google Gemini so the trainer can answer. Then a short questionnaire (height, weight, goal, training days) – any plausible values work.

PURCHASES: This version is free and contains no in-app purchases.

HEALTH: Apple Health is optional (Account → Apple Health). The app reads steps, sleep, resting heart rate, workouts and scale weight, and writes finished sessions. Health data is never used for advertising.

SAFETY: The app gives training and nutrition guidance, not medical advice. Calorie and protein targets have hard-coded minimums the AI cannot override, and onboarding refuses a calorie deficit to anyone underweight or still growing.

ACCOUNT: Delete account: Account → Delete account. Export data: Account → Your data → Export my data. Withdraw consent: Account → Your data.
```

**Contact:** the name, phone and email of whoever answers Apple's questions.

---

## Age rating

Apple's questionnaire changed in 2025; answer from what the app does, not from
what fitness apps usually get. The honest answers:

| Question | Answer |
|---|---|
| Medical or treatment information | Infrequent — calorie and protein targets, a "see a doctor" on joint pain; no diagnosis, no treatment |
| Health or wellness topics | Yes |
| Unrestricted web access | No |
| User-generated content shared with others | No — the chat is between one person and the trainer |
| Messaging / chat | Yes, with the AI trainer only |
| Violence, sexual content, profanity, gambling, alcohol, drugs | None |
| Contests, loot boxes | No |

Expect **13+** or **16+**. If the questionnaire lands on 18+, look again at the
medical answer before accepting it.

---

## App Privacy ("nutrition label")

**Tracking:** no. Nothing is used to track anybody across apps or websites.

Everything below is **linked to the person** and used for **App
Functionality** only — no analytics, no advertising, no product
personalisation beyond the trainer itself.

| Data type | Collected | Why it is on the list |
|---|---|---|
| Contact info → Name | Yes | from Sign in with Apple, if shared |
| Contact info → Email address | Yes | from Sign in with Apple, if shared |
| Health & fitness → Health | Yes | body weight, measurements, Apple Health (steps, sleep, resting heart rate, scale weight) |
| Health & fitness → Fitness | Yes | sessions, sets, cardio, Apple Health workouts |
| User content → Photos or videos | Yes | meal and fridge photos go to Gemini to be read. Not stored — but Apple's "collected" means leaving the device, and they do |
| User content → Other user content | Yes | messages to the trainer, meals, food rules |
| Identifiers → User ID | Yes | the account id |
| Usage data | No | there is no analytics |
| Diagnostics | No | no crash or performance reporting leaves the phone |
| Location | No | places are names somebody typed, not coordinates |

Third parties the label is about: **Google** (Gemini) receives messages,
numbers, Health data and photos to produce answers; **DigitalOcean** hosts the
server. Neither uses the data for its own purposes — which is what the
privacy notice says, and what the label has to agree with.

---

## When StoreKit ships (1.1)

- Description: a line on the subscription, the price is shown by Apple.
- Review notes: how to reach the paywall, that a sandbox account can buy, and
  that Restore Purchases is on it.
- App Privacy: **Purchases → Purchase history**, linked, App Functionality.
- The subscription group and both products need their own review metadata and
  a screenshot of the paywall, and are submitted **with** the version.
- `PURCHASES_AVAILABLE` in `app/src/lib/purchases.ts` flips to `true`.
