#!/usr/bin/env python3
import argparse
import json
import os
import sys
import time
from pathlib import Path
from playwright.sync_api import sync_playwright

STATE_DIR = Path(os.environ.get("HCU_STATE_DIR", "/workspaces/hermes-dashboard/hermes-computer-use/state"))
PROFILE_DIR = STATE_DIR / "profile"
DOWNLOAD_DIR = STATE_DIR / "downloads"
LOG_FILE = STATE_DIR / "actions.jsonl"

for p in (STATE_DIR, PROFILE_DIR, DOWNLOAD_DIR):
    p.mkdir(parents=True, exist_ok=True)


def log(action, payload=None):
    record = {"ts": time.time(), "action": action, "payload": payload or {}}
    with LOG_FILE.open("a", encoding="utf-8") as f:
        f.write(json.dumps(record, ensure_ascii=False) + "\n")


def connect(playwright):
    cdp = os.environ.get("HCU_CDP_URL", "http://127.0.0.1:9222")
    browser = playwright.chromium.connect_over_cdp(cdp)
    if not browser.contexts:
        raise RuntimeError("No Chromium context exposed over CDP")
    context = browser.contexts[0]
    page = context.pages[0] if context.pages else context.new_page()
    return browser, context, page


def main():
    parser = argparse.ArgumentParser(description="HERMES COMPUTER USE CLI")
    sub = parser.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("open")
    p.add_argument("url")

    p = sub.add_parser("click")
    p.add_argument("selector")

    p = sub.add_parser("fill")
    p.add_argument("selector")
    p.add_argument("text")

    p = sub.add_parser("text")
    p.add_argument("selector", nargs="?", default="body")

    p = sub.add_parser("screenshot")
    p.add_argument("path")

    sub.add_parser("pages")

    p = sub.add_parser("download")
    p.add_argument("selector")

    p = sub.add_parser("handoff")
    p.add_argument("reason")

    p = sub.add_parser("wait")
    p.add_argument("seconds", type=float)

    with sync_playwright() as pw:
        browser, context, page = connect(pw)
        try:
            if args := vars(parser.parse_args()):
                cmd = args["cmd"]
                if cmd == "open":
                    page.goto(args["url"], wait_until="domcontentloaded", timeout=60000)
                    log("open", {"url": page.url})
                    print(page.url)
                elif cmd == "click":
                    page.locator(args["selector"]).first.click(timeout=30000)
                    log("click", {"selector": args["selector"]})
                elif cmd == "fill":
                    page.locator(args["selector"]).first.fill(args["text"], timeout=30000)
                    log("fill", {"selector": args["selector"], "text_redacted": True})
                elif cmd == "text":
                    value = page.locator(args["selector"]).first.inner_text(timeout=30000)
                    log("text", {"selector": args["selector"]})
                    print(value)
                elif cmd == "screenshot":
                    path = Path(args["path"])
                    path.parent.mkdir(parents=True, exist_ok=True)
                    page.screenshot(path=str(path), full_page=True)
                    log("screenshot", {"path": str(path)})
                    print(path)
                elif cmd == "pages":
                    urls = [p.url for p in context.pages]
                    log("pages", {"count": len(urls)})
                    print(json.dumps(urls, ensure_ascii=False, indent=2))
                elif cmd == "download":
                    with page.expect_download(timeout=60000) as info:
                        page.locator(args["selector"]).first.click()
                    download = info.value
                    target = DOWNLOAD_DIR / download.suggested_filename
                    download.save_as(str(target))
                    log("download", {"path": str(target)})
                    print(target)
                elif cmd == "handoff":
                    handoff = STATE_DIR / "HANDOFF.json"
                    handoff.write_text(json.dumps({"reason": args["reason"], "url": page.url, "ts": time.time()}, ensure_ascii=False, indent=2), encoding="utf-8")
                    log("handoff", {"reason": args["reason"], "url": page.url})
                    print("HANDOFF_READY")
                elif cmd == "wait":
                    time.sleep(args["seconds"])
                    log("wait", {"seconds": args["seconds"]})
        finally:
            browser.close()


if __name__ == "__main__":
    main()
