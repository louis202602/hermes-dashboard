#!/usr/bin/env python3
"""Captures d'écran + contrôles de mise en page (FIXTURES DE TEST uniquement).
Usage : python3 shots.py <dossierSortie>   (lit <dossier>/html/*.html, écrit <dossier>/*.png et report.json)
Chromium : /opt/pw-browsers/chromium (executable_path, pas d'installation).
"""
import json
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

OUT = Path(sys.argv[1])
VIEWPORTS = {
    "iphone-390x844": (390, 844, 3),
    "tab-s9-portrait-924x1480": (924, 1480, 2),
    "tab-s9-paysage-1480x924": (1480, 924, 2),
    "bureau-1440x900": (1440, 900, 1),
}
CHECK = """
() => {
  const vw = window.innerWidth;
  const r = { scrollWidth: document.documentElement.scrollWidth, innerWidth: vw, small: [], minFont: 99, overflowing: [] };
  const sel = 'button, a[href], select, input:not([type=hidden]), summary, label.mo-check, [tabindex]:not([tabindex="-1"])';
  for (const el of document.querySelectorAll(sel)) {
    const b = el.getBoundingClientRect();
    if (b.width === 0 || b.height === 0) continue;
    if (b.height < 43.5 || b.width < 43.5) r.small.push({ tag: el.tagName, cls: el.className, text: (el.innerText || el.name || '').slice(0, 40), w: Math.round(b.width), h: Math.round(b.height) });
  }
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = walker.nextNode())) {
    if (!n.textContent.trim() || !n.parentElement || n.parentElement.closest('style,script')) continue;
    const cs = getComputedStyle(n.parentElement);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    const fs = parseFloat(cs.fontSize);
    if (fs < r.minFont) r.minFont = fs;
  }
  for (const el of document.querySelectorAll('.mo-page *')) {
    const b = el.getBoundingClientRect();
    if (b.right > vw + 1) r.overflowing.push(el.tagName + '.' + el.className);
  }
  r.overflowing = r.overflowing.slice(0, 8);
  return r;
}
"""

report = {}
with sync_playwright() as p:
    browser = p.chromium.launch(executable_path="/opt/pw-browsers/chromium", args=["--no-sandbox"])
    for vname, (w, h, dpr) in VIEWPORTS.items():
        ctx = browser.new_context(viewport={"width": w, "height": h}, device_scale_factor=dpr,
                                  has_touch=(w < 1000), is_mobile=(w < 500), locale="fr-FR")
        page = ctx.new_page()
        for html in sorted((OUT / "html").glob("*.html")):
            page.goto(html.resolve().as_uri())
            page.wait_for_load_state("load")
            name = f"{html.stem}__{vname}.png"
            page.screenshot(path=str(OUT / name), full_page=True)
            report[name] = page.evaluate(CHECK)
        ctx.close()
    browser.close()

(OUT / "report.json").write_text(json.dumps(report, indent=1, ensure_ascii=False))
for k, v in report.items():
    print(k, "| défilement horiz.:", v["scrollWidth"] > v["innerWidth"], f"({v['scrollWidth']}/{v['innerWidth']})",
          "| cibles <44px:", len(v["small"]), "| police min:", v["minFont"], "| débordements:", len(v["overflowing"]))
