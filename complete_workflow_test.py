#!/usr/bin/env python3
"""Complete workflow test for PPT generation"""
import requests
import json
import sys
import time
import re

BASE_URL = "http://localhost:8000"
API_BASE = f"{BASE_URL}/api/v1/ppt"

def parse_sse(line):
    """Parse Server-Sent Events"""
    if line.startswith('data: '):
        return json.loads(line[6:])
    return None

def test_complete_workflow():
    # Step 1: Create presentation
    print("="*80)
    print("STEP 1: Creating presentation...")
    print("="*80)
    resp = requests.post(f"{API_BASE}/create", json={
        "prompt": "The benefits of artificial intelligence",
        "n_slides": 3,
        "language": "en"
    })
    if resp.status_code != 200:
        print(f"ERROR: Create failed with status {resp.status_code}")
        return False
    pres = resp.json()
    pres_id = pres['id']
    print(f"✓ Created presentation: {pres_id}")

    # Step 2: Generate outlines
    print("\n" + "="*80)
    print("STEP 2: Generating outlines...")
    print("="*80)
    resp = requests.post(f"{API_BASE}/outlines/generate", json={"presentation_id": pres_id}, timeout=120)
    if resp.status_code != 200:
        print(f"ERROR: Outlines failed with status {resp.status_code}")
        return False
    outlines_data = resp.json()
    outlines = outlines_data.get('outlines', [])
    print(f"✓ Generated {len(outlines)} outlines")
    print(f"  Title: {outlines_data.get('title')}")

    # Step 3: Submit generation data
    print("\n" + "="*80)
    print("STEP 3: Submitting generation data...")
    print("="*80)
    generation_request = {
        "presentation_id": pres_id,
        "outlines": outlines,
        "title": outlines_data.get('title'),
        "theme": {"name": "light"}
    }
    resp = requests.post(f"{API_BASE}/generate/data", json=generation_request)
    if resp.status_code != 200:
        print(f"ERROR: Generate data failed with status {resp.status_code}")
        print(resp.text)
        return False
    session_data = resp.json()
    session_id = session_data.get('session')
    print(f"✓ Got session ID: {session_id}")

    # Step 4: Stream generation
    print("\n" + "="*80)
    print("STEP 4: Streaming slide generation...")
    print("="*80)
    resp = requests.get(
        f"{API_BASE}/generate/stream",
        params={"presentation_id": pres_id, "session": session_id},
        stream=True,
        timeout=300
    )
    if resp.status_code != 200:
        print(f"ERROR: Stream failed with status {resp.status_code}")
        return False

    presentation_result = None
    for line in resp.iter_lines():
        if line:
            line = line.decode('utf-8')
            if line.startswith('event: '):
                event_type = line[7:]
                print(f"  Event type: {event_type}")
            elif line.startswith('data: '):
                try:
                    data = json.loads(line[6:])
                    # print(f"  Data: {str(data)[:200]}")
                    if data.get('type') == 'complete' and 'presentation' in data:
                        presentation_result = data.get('presentation')
                        print("✓ Received complete presentation data")
                        break
                    elif 'status' in data:
                        print(f"  Status: {data['status']}")
                except json.JSONDecodeError as e:
                    print(f"  JSON decode error: {e}")
                    pass

    if not presentation_result:
        print("ERROR: No presentation result received from stream")
        return False

    slides = presentation_result.get('slides', [])
    print(f"✓ Generated {len(slides)} slides")

    # Step 5: Get the presentation to check slides
    print("\n" + "="*80)
    print("STEP 5: Fetching presentation with slides...")
    print("="*80)
    resp = requests.get(f"{API_BASE}/presentation", params={"presentation_id": pres_id})
    if resp.status_code != 200:
        print(f"ERROR: Get presentation failed")
        return False
    full_pres = resp.json()
    slides = full_pres.get('slides', [])
    print(f"✓ Got presentation with {len(slides)} slides")

    if len(slides) == 0:
        print("ERROR: No slides in presentation")
        return False

    # Now we need to construct the pptx_model from the slides
    # The slides are in SlideModel format, we need to convert them to Pptx format
    # Let me check if there's a conversion endpoint or if we need to call export directly

    print("\n" + "="*80)
    print("STEP 6: Attempting export with slides data...")
    print("="*80)

    # The export endpoint expects a pptx_model, which is constructed from slides
    # Looking at the frontend code, it seems like the client converts SlideModels to PptxModels
    # For now, let's try calling the export endpoint and see what it expects

    print("⚠ Cannot proceed: Need to understand pptx_model conversion")
    print(f"   Presentation ID: {pres_id}")
    print(f"   Slides available: {len(slides)}")

    return pres_id, slides

if __name__ == "__main__":
    result = test_complete_workflow()
    if result:
        print("\n✓ Generated presentation successfully!")
        print(f"   Presentation ID: {result[0]}")
        print(f"   Slides: {len(result[1])}")
    else:
        print("\n✗ Test failed")
        sys.exit(1)
