# CONTRACT — Hip Hop Diaper Bag — "VITRINE"

Rolled from `surprise-me/scripts/roll.sh`, seed `1786671644180394936`.
Direction **#3 of 7** won. This contract is **locked** — the audit judges the render
against this card. Move the render to the contract, never the contract to the render.

---

## The seven directions authored before the roll

1. Train yard at 3am — subway-yard grit, spray haze, sodium light. Illicit, reverent.
2. Blackbook — the page as a marker-and-paper sketchbook. Intimate, analog, hand-made.
3. **Boutique vitrine — cold gallery, product on a plinth, single spotlight, luxury restraint; the loud print is the only colour.** ← ROLLED
4. Block party, 6pm — sun-drenched, speakers, folding tables. Joyful, communal, loud.
5. Spec sheet — engineering drawing, callouts, monospace measurements. Exact, obsessive.
6. Boom-bap rig — SP-1200 / MPC panel; the page as a sampler you play. Tactile, rhythmic.
7. Diaper-bag noir — high-contrast B&W film, hard shadows. Serious, cool, adult.

---

## The card

**Feeling in one line**
You walked into a raw-concrete gallery after hours, and the only thing under the light
is a diaper bag — and the guard is nowhere, and you're allowed to touch it.

**Palette** (earthy brutalist: concrete grey, safety orange, black)
```
--void        #0A0A0B   page ground, the unlit gallery
--slab        #16161A   surfaces, plinth faces
--crete       #8E8B84   concrete mid — rules, secondary type
--dust        #C9C5BC   concrete light — body copy on dark
--paper       #F4F2ED   the lit face, headline ink
--hazard      #FF4A00   safety orange — the ONLY accent, CTA + live state
--hazard-deep #C43300   pressed / shadow state of hazard
```
Nothing else gets a colour. The graffiti print is black-and-white and is the loudest
thing on the page by design — the palette exists to stay out of its way.

**Type**
- Display: **Archivo Variable** (`wght 100–900`, `wdth 62–125`), self-hosted.
  The kinetic rule: headlines animate weight *and* width on entry, never opacity alone.
- Placard / spec: **JetBrains Mono**, 11–13px, `letter-spacing: .14em`, uppercase.
  This is the museum wall-label voice. All measurements, counts and captions use it.
- Scale contrast rule: display is never below `clamp(2.5rem, 7vw, 9rem)`; placard is
  never above 13px. There is no middle. That gap *is* the type system.

**Layout** — broken / asymmetric grid, intentional tension
12-column grid, but the vitrine column sits at 0.38/0.62, never centred.
**The unusual rule: every section has exactly one element that bleeds past a viewport
edge, and nothing on the page is horizontally centred. Ever.**

**Techniques (all three, woven in — not bolted on)**
1. **Magnetic / warping cursor + pointer-reactive elements** — a custom "handle with
   care" ring cursor; CTAs and the plinth magnetically attract it; the hero shader
   warps toward the pointer. On the hero this yields to the hand.
2. **Scroll choreography** — the vitrine pins while the 13-pocket callouts stage in,
   then the orbit timeline scrubs in reverse as you scroll out of the pin.
3. **Otherworldly animation** — a living particle field: concrete dust / atomised
   spray drifting through the light cone, physics-driven, displaced by the pointer.

**Motion signature**
One slow GLSL concrete-and-light field behind everything, in constant hypnotic motion.
It never stops and it never repeats visibly.

**The one unmistakable moment**
The visitor raises a hand to their webcam. They close their fist and the bag turns
in the vitrine with their hand — real product, real frames, 1:1 with their wrist.
Open the hand and it keeps spinning on inertia.

**Assets** (all real, none faked)
- Real product stills: front / side / back + the 2500×2560 studio frame with changing
  pad and insulated bottle sleeve.
- Higgsfield-generated 360° orbit, sliced by ffmpeg into a frame sequence.
- Real brand lifestyle photography.
- Self-hosted variable fonts.

**Out of scope** (deliberately, to stay disciplined)
No purple/blue or teal/orange gradients. No centred hero. No three feature cards.
No pricing table. No emoji as iconography. No box-shadow pretending to be depth.
No dark-mode toggle. No cookie-banner theatre. No stock photography that isn't
this brand's own.

---

## The bar

`https://activetheory.net/work` — screenshotted desktop (1440×900 @2x) and mobile
(390×844 @3x), compared **blind, side by side**, not against a description.

Measured half: **60fps sustained on the hero** and **Lighthouse performance ≥ 90**.

## Exit condition

Each piece — hero interaction, 360 asset, motion, type, colour, layout, mobile, CTA —
is judged by a critic with fresh context who does not know which render is ours.
The loop exits only when the critic picks ours blind. Praise is not evidence.
