# INFINITY — 30s launch film

**Vibe:** cinematic, dark, premium sci-fi. Villain (pump.fun extraction) → hero (Infinity, 0 fees).
**Format:** 9:16 vertical (X / TikTok) + a 16:9 cut. ~30s. Neon violet #7B2BFF ↔ cyan #00F0FF, obsidian black.
**Pipeline:** `generate_image` (keyframe) → `generate_video` (image-to-video, add motion) per shot, then cut together.
For a fully narrated build, `get_workflow_instructions` → an ad / explainer workflow can auto-assemble VO + shots.

---

## Voiceover (record cold, confident, slightly menacing → hopeful)

> Every single day, pump.fun farms **millions** from the trenches.
> Your trades. Your launches. Their revenue.
> The house always wins… until now.
> **Infinity.** Zero fees. Not one percent — **zero.**
> One hundred percent goes back to **you** and the holders.
> Launch with only your token. Liquidity locked forever. Unruggable.
> The trenches don't have to feed the machine anymore.
> **Infinity. Trade free. infinitydex.pro**

*(~28s at a steady read.)*

---

## On-screen text (kinetic, Syncopate / wide caps)

`MILLIONS FARMED DAILY` → `FROM THE TRENCHES` → `THIS HAS TO CHANGE` → `0.00% FEES` →
`100% TO YOU + HOLDERS` → `PERMANENT · UNRUGGABLE` → `∞ INFINITY` → `infinitydex.pro`

---

## Storyboard — 6 shots

### SHOT 1 · 0–5s · THE VILLAIN (money drain)
**Text:** "MILLIONS FARMED DAILY"
**Image prompt (generate_image, nano_banana_pro, 9:16):**
> Dark cinematic scene, a colossal black slot-machine / money-vacuum machine looming over a trench of tiny glowing traders, streams of golden coins and dollar particles being sucked upward into the machine's maw, cold blue rim light, volumetric fog, oppressive scale, film grain, moody, dystopian crypto casino, 8K, shallow depth of field. No text.
**Video prompt (generate_video, image-to-video):**
> Slow push-in toward the machine as coin streams accelerate upward into it; embers and dust drift; subtle camera shake; ominous.

### SHOT 2 · 5–10s · THE TRENCHES
**Text:** "FROM THE TRENCHES" → "THIS HAS TO CHANGE"
**Image prompt:**
> Top-down of a glowing trench line of anonymous crypto traders as small light silhouettes, thin red extraction lines pulling value out of each of them toward a distant dark tower, rain, neon reflections, cyberpunk, cinematic, high contrast, 8K. No text.
**Video prompt:**
> The red extraction lines pulse and drain; one silhouette looks up; a violet light cracks the sky behind the tower (foreshadow the hero).

### SHOT 3 · 10–16s · THE REVEAL (∞ ribbon)
**Text:** "0.00% FEES"
**Image prompt:**
> A massive luminous infinity-symbol ribbon of flowing liquid chrome, iridescent violet-to-cyan with a white-hot core, floating in a black void with a faint mirror-tunnel of infinity shapes receding behind it, token coins orbiting one lobe, volumetric glow, premium, Awwwards, 8K, crisp. No text.
**Video prompt:**
> The infinity ribbon rotates smoothly and leans as if reacting to the viewer; the white-hot core pulses; coins orbit; light blooms — hero reveal energy.

### SHOT 4 · 16–22s · THE PRODUCT (UI)
**Text:** "100% TO YOU + HOLDERS"
**Use real UI:** screen-record https://www.infinitydex.pro (home → launch → swap), OR
**Image prompt (stylized UI):**
> Sleek dark glassmorphism trading dApp UI floating in 3D space, panels showing "PROTOCOL FEE 0.00%", "100% OF FEES → HOLDERS", a glowing infinity confirm button, violet/cyan neon, frosted glass shards, holographic, product hero shot, 8K. No text overlaps.
**Video prompt:**
> Camera glides across the floating glass panels; numbers count to 0.00%; the infinity button ignites with a light sweep.

### SHOT 5 · 22–27s · THE PROMISE
**Text:** "PERMANENT · UNRUGGABLE"
**Image prompt:**
> A glowing token coin being sealed inside an unbreakable crystal infinity loop, chains of light locking permanently, deep violet and cyan, particles, cinematic, powerful, 8K. No text.
**Video prompt:**
> The loop snaps shut around the coin with a shockwave of light; it locks and glows — permanence, security.

### SHOT 6 · 27–30s · LOGO + CTA
**Text:** "∞ INFINITY" → "infinitydex.pro"
**Image prompt:**
> The Infinity logo — a glowing violet-to-cyan infinity mark on a dark round coin — centered on pure black with a soft radial glow and drifting stars, minimal, premium brand end-card, 8K. No other text.
**Video prompt:**
> The logo coin materializes from light particles, glows, and the wordmark INFINITY resolves beneath it; gentle bloom; hold.

---

## Music / SFX
- 0–10s: dark pulsing sub-bass, ticking/clockwork, a rising ominous drone (the villain).
- 10–16s: a beat drop / riser at the ∞ reveal — flip from menacing to euphoric, big synth.
- 16–30s: driving, hopeful electronic anthem; whooshes on text hits; a final impact + shimmer on the logo.
- VO ducked over the bed; the word "**zero**" lands on a silence/hit.

## Assets on hand
- Logo coin: `public/logo.png` (transparent), `public/favicon.png`.
- Live UI to screen-capture: https://www.infinitydex.pro (#launch, #swap, #pools).
- Brand colors: violet #7B2BFF, cyan #00F0FF, ink #020204.

---

## MUSIC — Suno prompt (instrumental, ~30s under the VO)

**Style box (paste this, Instrumental ON):**
> Cinematic dystopian trailer score turning into a euphoric anthem. Dark ominous intro: deep sub-bass, ticking clockwork, tense rising riser and a low ominous drone (menacing, "the machine"). Hard drop at ~10 seconds into bright euphoric future-bass / supersaw synths, big and hopeful. Driving triumphant electronic energy through the middle. Final massive impact hit with a shimmering reverb tail at the end. 145 BPM, key of A minor, wide stereo, heavy but clean low end, no vocals, no lyrics.

**Structure tags (optional, Suno custom):**
```
[Intro: dark, sub-bass, ticking, riser 0:00-0:10]
[Drop: euphoric supersaw synths, big 0:10-0:15]
[Main: driving anthem 0:15-0:27]
[Impact: final hit + shimmer tail 0:27-0:30]
```

**Notes:**
- Keep it **instrumental** (it sits under the Brooks voiceover).
- Generate, then **trim so the drop lands at ~10s** — that's the ∞ reveal shot (the flip from villain to hero).
- Put a silence/duck on the beat where the VO says "**zero**" for impact.
- Add the music in CapCut/Premiere under `infinity-launch-30s-VO.mp4` (VO already baked in) — lower the music ~-8 dB under the voice.
