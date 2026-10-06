"""Generate ONLY the Play Store feature graphic (1024x500)."""
import base64
import os
import sys
import time
from pathlib import Path
from dotenv import load_dotenv
from PIL import Image

BACKEND_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BACKEND_DIR / ".env")

OUT_DIR = BACKEND_DIR.parent / "frontend" / "assets" / "store"
OUT_DIR.mkdir(parents=True, exist_ok=True)

PROMPT = (
    "Cinematic Google Play feature-graphic banner for a social music app called 'GeoBeats'. "
    "Wide horizontal composition. Dark deep-space background with a glowing 3D holographic globe "
    "on the right side; the globe has neon cyan atmospheric glow and thin glowing purple-to-pink "
    "longitude lines. Floating above the globe are glowing music pins (circular marker pins) with "
    "tiny album-art squares and soft neon aura. On the left side, bold word 'GeoBeats' in thick "
    "modern sans-serif, with a subtle gradient from deep violet #A259FF to electric cyan #22D3EE, "
    "and below it the tagline 'Real-time music, everywhere' in thin elegant lettering. "
    "Starfield particles, slight chromatic aberration, subtle purple haze, premium app-store banner "
    "aesthetic, 4k, hyper-clean, no people, no faces, no logos other than 'GeoBeats'."
)


def _crop_to(img, target_w, target_h):
    w, h = img.size
    target_ratio = target_w / target_h
    cur_ratio = w / h
    if cur_ratio > target_ratio:
        new_w = int(h * target_ratio)
        left = (w - new_w) // 2
        img = img.crop((left, 0, left + new_w, h))
    else:
        new_h = int(w / target_ratio)
        top = (h - new_h) // 2
        img = img.crop((0, top, w, top + new_h))
    return img.resize((target_w, target_h), Image.LANCZOS)


def gen_via_emergent():
    import asyncio
    from emergentintegrations.llm.openai.image_generation import OpenAIImageGeneration

    async def _run():
        gen = OpenAIImageGeneration(api_key=os.environ["EMERGENT_LLM_KEY"])
        images = await gen.generate_images(
            prompt=PROMPT, model="gpt-image-1", number_of_images=1
        )
        raw = images[0]
        if isinstance(raw, (bytes, bytearray)):
            return bytes(raw)
        if isinstance(raw, dict):
            s = raw.get("image_base64") or raw.get("b64_json") or ""
            return base64.b64decode(s)
        return base64.b64decode(raw)

    return asyncio.run(_run())


def main():
    last_err = None
    for attempt in range(1, 5):
        try:
            print(f"🎨 Attempt {attempt}/4 — generating feature graphic...")
            data = gen_via_emergent()
            tmp = OUT_DIR / "_feature_raw.png"
            tmp.write_bytes(data)
            img = Image.open(tmp).convert("RGB")
            print(f"   Raw image: {img.size}")
            out = _crop_to(img, 1024, 500)
            path = OUT_DIR / "feature_graphic.png"
            out.save(path, format="PNG", optimize=True)
            tmp.unlink(missing_ok=True)
            kb = os.path.getsize(path) // 1024
            print(f"✅ feature_graphic.png  → {path}  ({kb} KB, 1024x500)")
            return 0
        except Exception as e:
            last_err = e
            print(f"   ⚠️  {type(e).__name__}: {str(e)[:200]}")
            time.sleep(4 * attempt)
    print(f"❌ All attempts failed. Last error: {last_err}")
    return 1


if __name__ == "__main__":
    sys.exit(main())
