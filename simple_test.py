#!/usr/bin/env python3
"""Simple test to understand the API workflow"""
import requests
import json
import sys

BASE_URL = "http://localhost:8000"
API_BASE = f"{BASE_URL}/api/v1/ppt"

# Step 1: Create presentation
print("Creating presentation...")
resp = requests.post(f"{API_BASE}/create", json={
    "prompt": "AI benefits",
    "n_slides": 3,
    "language": "en"
})
print(f"Create response ({resp.status_code}):")
pres = resp.json()
print(json.dumps(pres, indent=2))
pres_id = pres['id']

# Step 2: Generate outlines
print(f"\nGenerating outlines for {pres_id}...")
resp = requests.post(f"{API_BASE}/outlines/generate", json={"presentation_id": pres_id})
print(f"Outlines response ({resp.status_code}):")
outlines_data = resp.json()
print(json.dumps(outlines_data, indent=2)[:500])

# Step 3: Get full presentation
print(f"\nGetting presentation data...")
resp = requests.get(f"{API_BASE}/presentation", params={"presentation_id": pres_id})
print(f"Get presentation response ({resp.status_code}):")
full_pres = resp.json()
print(json.dumps(full_pres, indent=2)[:1000])
print("...")
print(f"Has pptx_model: {'pptx_model' in full_pres.get('presentation', {})}")
print(f"Slides count: {len(full_pres.get('slides', []))}")
