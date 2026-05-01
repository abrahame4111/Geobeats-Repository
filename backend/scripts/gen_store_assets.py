"""Generate Google Play store listing assets for GeoBeats.

Produces under /app/frontend/assets/store/:
  - icon_512.png          (app icon, exactly 512x512 PNG)
  - feature_graphic.png   (Play feature graphic, exactly 1024x500 PNG)
"""
import asyncio
import base64
import os
import sys
from pathlib import Path

from dotenv import load_dotenv
from PIL import Image

BACKEND_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BACKEND_DIR / ".env")

OUT_DIR = BACKEND_DIR.parent / "frontend" / "assets" / "store"
OUT_DIR.mkdir(parents=True, exist_ok=True)

ASSETS_IMG = BACKEND_DIR.parent / "frontend" / "assets" / "images"


def resize_icon():
    src = ASSETS_IMG / "icon.png"
    img = Image.open(src).convert("RGBA")
    img_512 = img.resize((512, 512), Image.LANCZOS)
    out_path = OUT_DIR / "icon_512.png"
    img_512.save(out_path, format="PNG", optimize=True)
    size_kb = os.path.getsize(out_path) // 1024
    print(f"✅ icon_512.png  → {out_path}  ({size_kb} KB)")


async def gen_feature_graphic():
    """Use Emergent LLM Key (gpt-image-1) to generate a 1024x500 wide banner.

    gpt-image-1 natively supports 1536x1024 and 1024x1024 but not 1024x500,
    so we request 1536x1024 and crop/resize to 1024x500 afterwards.
    """
    from emergentintegrations.llm.openai.image_generation import (
        OpenAIImageGeneration,
    )

    key = os.environ["EMERGENT_LLM_KEY"]
    gen = OpenAIImageGeneration(api_key=key)

    prompt = (
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

    print("🎨 Generating feature graphic via gpt-image-1...")
    images = await gen.generate_images(
        prompt=prompt,
        model="gpt-image-1",
        number_of_images=1,
    )

    raw = images[0]
    # emergentintegrations returns bytes directly
    if isinstance(raw, (bytes, bytearray)):
        data = bytes(raw)
    else:  # fall back to base64 or dict if shape changes
        if isinstance(raw, dict):
            raw = raw.get("image_base64") or raw.get("b64_json") or ""
        data = base64.b64decode(raw)

    tmp = OUT_DIR / "_feature_raw.png"
    tmp.write_bytes(data)

    img = Image.open(tmp).convert("RGB")
    w, h = img.size
    # crop to 1024:500 aspect ratio (ratio = 2.048)
    target_ratio = 1024 / 500
    cur_ratio = w / h
    if cur_ratio > target_ratio:
        # too wide, crop horizontally
        new_w = int(h * target_ratio)
        left = (w - new_w) // 2
        img = img.crop((left, 0, left + new_w, h))
    else:
        # too tall, crop vertically
        new_h = int(w / target_ratio)
        top = (h - new_h) // 2
        img = img.crop((0, top, w, top + new_h))
    img = img.resize((1024, 500), Image.LANCZOS)
    out_path = OUT_DIR / "feature_graphic.png"
    img.save(out_path, format="PNG", optimize=True)
    try:
        tmp.unlink()
    except Exception:
        pass
    size_kb = os.path.getsize(out_path) // 1024
    print(f"✅ feature_graphic.png  → {out_path}  ({size_kb} KB, 1024x500)")


async def main():
    resize_icon()
    await gen_feature_graphic()
    print("\n🎉 Done. Upload these to Play Console → Store listing:")
    print(f"   • App icon:        {OUT_DIR}/icon_512.png")
    print(f"   • Feature graphic: {OUT_DIR}/feature_graphic.png")


if __name__ == "__main__":
    asyncio.run(main())
