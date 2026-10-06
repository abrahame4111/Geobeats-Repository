"""Generate Play Store phone screenshots (9:16 portrait) via gpt-image-1.

Output: /app/frontend/assets/store/screenshots/ss_{N}_{label}.png
Each final image is 1080x1920 PNG (center-cropped from 1024x1536).
"""
import asyncio
import base64
import os
import sys
import time
from pathlib import Path
from dotenv import load_dotenv
from PIL import Image

BACKEND_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BACKEND_DIR / ".env")

OUT_DIR = BACKEND_DIR.parent / "frontend" / "assets" / "store" / "screenshots"
OUT_DIR.mkdir(parents=True, exist_ok=True)

# Common stylistic guard rails so all 5 shots look like the same app
COMMON_STYLE = (
    "Vertical smartphone app screenshot, portrait 9:16 aspect ratio, realistic "
    "Android phone UI mockup, dark UI theme with deep violet and cyan neon accents "
    "(#A259FF purple, #22D3EE cyan, #0B0320 near-black background), glassmorphic "
    "cards with subtle blur, white typography, SF Pro / Inter font feel, subtle "
    "starfield background. Top of screen: faint Android status bar with time "
    "'9:41' and battery/signal icons. No Apple/iOS elements. No physical phone "
    "bezel/frame around the screenshot — full-bleed app content only. "
    "Photorealistic UI, sharp details, hyper-clean. The app is called 'GeoBeats'."
)

SHOTS = [
    (
        "01_map",
        "Live global 3D music map — the hero screen. A stylized Mapbox-style "
        "dark-neon globe centered on the screen, viewed at 45-degree tilt. "
        "Glowing purple and pink circular pins scattered across continents, each "
        "pin has a tiny circular album-art thumbnail inside with a subtle neon halo. "
        "Faint heatmap bloom where pins cluster (Berlin, Tokyo, LA, NYC). "
        "Top bar: 'GeoBeats' wordmark in purple-to-cyan gradient, left side. "
        "Right side of top bar: small circular user avatar. Floating bottom-right: "
        "a round neon-purple FAB button with a radar/signal-wave icon (Song Radar). "
        "Bottom: compact 'Now Playing' glass card showing album art, track title "
        "'Midnight City', artist 'M83', and cyan progress bar."
    ),
    (
        "02_listen_along",
        "Listen Along session screen. Top two-thirds: a paused map view as backdrop "
        "with a blurred glowing pin highlighted. Foreground center: large glassmorphic "
        "bottom sheet card showing: user avatar (circular, with 'LIVE' pulse ring in "
        "cyan), username 'maya_in_tokyo', small location tag '📍 Shibuya, Tokyo'. "
        "Below: large album artwork (abstract neon gradient square), track title "
        "'Something In The Way' by 'Nirvana', cyan waveform animation bar mid-track. "
        "Two large neon action buttons: primary purple 'LISTEN ALONG' with a headphones "
        "icon, secondary outline button 'ADD TO QUEUE'. Small sync indicator chip "
        "'synced • 12 ms drift' in cyan."
    ),
    (
        "03_song_radar",
        "Song Radar result screen — the 'wow' moment after identifying a song. "
        "Black background. Floating center of screen: a dramatic 3D tilted album-art "
        "card (like a holographic music card) slightly rotated with perspective, with "
        "rainbow chromatic-edge glow and a cyan-to-purple reflection. The card shows "
        "album art 'Blinding Lights' by 'The Weeknd'. Above the card: animated-looking "
        "concentric purple radar pulse rings fading outward. Title above: 'Song Found' "
        "in bold white, a small green checkmark. Below the card: two buttons — primary "
        "purple 'ADD TO QUEUE' and secondary outline 'OPEN IN APP'. Bottom: small "
        "subtitle 'Identified via GeoBeats Radar • 2 sec'."
    ),
    (
        "04_login",
        "Immersive splash / login screen. Full-bleed background: a mesmerizing "
        "volumetric WebGL-style particle effect — a slowly rotating 3D particle globe "
        "made of thousands of tiny glowing cyan and purple dots on deep black, with "
        "soft bloom. Centered top third: 'GeoBeats' wordmark in thick bold modern "
        "sans-serif with a gradient from deep purple #A259FF to electric cyan "
        "#22D3EE. Just below wordmark: thin elegant tagline 'Real-time music, "
        "everywhere.' Bottom third: a single large pill-shaped button with a "
        "neon purple rotating-starburst border, label 'CONNECT WITH SPOTIFY' in "
        "white uppercase with a small Spotify logo on the left. Small fine-print "
        "legal footer 'By continuing, you agree to our Terms & Privacy Policy'."
    ),
    (
        "05_heatmap",
        "Zoomed-in city view of the map screen showing a dense heatmap. A "
        "Mapbox-style dark-mode neighborhood map of a stylized city (feels like "
        "lower-Manhattan / Shibuya hybrid) with glowing streets. Dozens of small "
        "glowing purple pins clustered on the streets, with brighter cyan-purple "
        "blooms where pins overlap (heatmap effect). Upper overlay: thin info pill "
        "'247 listening nearby' with a pulse dot. Small top tabs: 'Friends • Nearby • "
        "Global'. Bottom glass strip: row of 5 circular user avatars who are "
        "currently live. Top-right corner: a hide-me toggle icon (eye) in cyan. "
        "No text errors, no fake app store badges, no logos besides 'GeoBeats'."
    ),
]


def _crop_to_1080x1920(img: Image.Image) -> Image.Image:
    """gpt-image-1 gives 1024x1536 (2:3). We need 9:16 = 0.5625. Crop vertically."""
    w, h = img.size
    target_ratio = 9 / 16
    cur_ratio = w / h
    if cur_ratio > target_ratio:
        # too wide -> crop left/right
        new_w = int(h * target_ratio)
        left = (w - new_w) // 2
        img = img.crop((left, 0, left + new_w, h))
    else:
        # too tall -> crop top/bottom (rarely happens w/ 2:3 source)
        new_h = int(w / target_ratio)
        top = (h - new_h) // 2
        img = img.crop((0, top, w, top + new_h))
    return img.resize((1080, 1920), Image.LANCZOS)


async def generate_one(label: str, prompt: str):
    from emergentintegrations.llm.openai.image_generation import OpenAIImageGeneration

    gen = OpenAIImageGeneration(api_key=os.environ["EMERGENT_LLM_KEY"])
    full_prompt = f"{prompt}\n\n{COMMON_STYLE}"

    images = await gen.generate_images(
        prompt=full_prompt,
        model="gpt-image-1",
        number_of_images=1,
    )

    raw = images[0]
    if isinstance(raw, (bytes, bytearray)):
        data = bytes(raw)
    elif isinstance(raw, dict):
        s = raw.get("image_base64") or raw.get("b64_json") or ""
        data = base64.b64decode(s)
    else:
        data = base64.b64decode(raw)

    tmp = OUT_DIR / f"_{label}_raw.png"
    tmp.write_bytes(data)
    img = Image.open(tmp).convert("RGB")
    out = _crop_to_1080x1920(img)
    out_path = OUT_DIR / f"ss_{label}.png"
    out.save(out_path, format="PNG", optimize=True)
    tmp.unlink(missing_ok=True)
    return out_path, out.size, os.path.getsize(out_path)


async def main():
    print(f"📸 Generating {len(SHOTS)} Play Store screenshots at 1080x1920...")
    print(f"   Output: {OUT_DIR}\n")
    for label, prompt in SHOTS:
        last_err = None
        for attempt in range(1, 4):
            try:
                print(f"  [{label}] attempt {attempt}/3 ...", flush=True)
                path, size, sz = await generate_one(label, prompt)
                print(f"  ✅ {path.name} — {size} ({sz // 1024} KB)")
                break
            except Exception as e:
                last_err = e
                msg = str(e)[:140]
                print(f"     ⚠️ {type(e).__name__}: {msg}")
                await asyncio.sleep(4 * attempt)
        else:
            print(f"  ❌ Gave up on {label}: {last_err}")
    print("\n🎉 Done. Upload these to Play Console → Store listing → Phone screenshots.")


if __name__ == "__main__":
    asyncio.run(main())
