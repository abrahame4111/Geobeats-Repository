"""
One-shot script to generate the GeoBeats app icon using OpenAI gpt-image-1
via the Emergent universal LLM key.

Run from /app:  python generate_icon.py
Outputs:       /app/frontend/assets/images/icon.png (1024x1024)
"""
import asyncio
import os
from emergentintegrations.llm.openai.image_generation import OpenAIImageGeneration


PROMPT = (
    "A premium iOS app icon for a real-time social music app called GeoBeats. "
    "A stylized 3D globe centered, rendered in deep electric violet and neon "
    "magenta, with glowing equalizer bars and concentric radar pulse rings "
    "wrapping around the equator. The globe is set against a near-black "
    "midnight purple gradient background with a subtle starfield. "
    "Highlights in vibrant magenta (#FF26B0) and electric purple (#B026FF) "
    "with soft neon bloom and chromatic aberration. Cyberpunk synth-wave "
    "aesthetic, like a Spotify x Apple Music premium product. "
    "Clean, minimal, full-bleed square composition optimized to read at "
    "small sizes. Absolutely no text, letters, words, or numbers anywhere. "
    "Sharp, polished, professional, photoreal 3D rendering with depth and "
    "subtle reflections. Square 1:1 aspect ratio."
)


async def main():
    key = os.environ.get("EMERGENT_LLM_KEY") or "sk-emergent-9A88bD6AbDcF67dC98"
    gen = OpenAIImageGeneration(api_key=key)
    print("[icon] Calling gpt-image-1 ...")
    images = await gen.generate_images(
        prompt=PROMPT,
        model="gpt-image-1",
        number_of_images=1,
    )
    if not images:
        raise SystemExit("No image returned")
    out_main = "/app/frontend/assets/images/icon.png"
    out_adapt = "/app/frontend/assets/images/adaptive-icon.png"
    out_splash = "/app/frontend/assets/images/splash-icon.png"
    out_favicon = "/app/frontend/assets/images/favicon.png"
    os.makedirs(os.path.dirname(out_main), exist_ok=True)
    img_bytes = images[0]
    for path in (out_main, out_adapt, out_splash, out_favicon):
        with open(path, "wb") as f:
            f.write(img_bytes)
        print(f"[icon] wrote {path} ({len(img_bytes)} bytes)")


if __name__ == "__main__":
    asyncio.run(main())
