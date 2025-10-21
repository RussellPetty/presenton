#!/usr/bin/env python3
"""
Test script for PowerPoint generation, export, and download
"""
import requests
import json
import time
import sys
import os

BASE_URL = "http://localhost:8000"
API_BASE = f"{BASE_URL}/api/v1/ppt"

def test_presentation_workflow():
    """Test the full workflow: create -> generate -> export -> download"""

    print("=" * 80)
    print("TESTING POWERPOINT GENERATION WORKFLOW")
    print("=" * 80)

    # Step 1: Create a presentation
    print("\n[1/4] Creating presentation...")
    create_data = {
        "prompt": "Create a presentation about the benefits of artificial intelligence",
        "n_slides": 5,
        "language": "en"
    }

    try:
        response = requests.post(f"{API_BASE}/create", json=create_data, timeout=60)
        response.raise_for_status()
        presentation = response.json()
        presentation_id = presentation['id']
        print(f"✓ Presentation created with ID: {presentation_id}")
    except Exception as e:
        print(f"✗ Failed to create presentation: {e}")
        return False

    # Step 2: Generate outlines
    print("\n[2/4] Generating outlines...")
    try:
        response = requests.post(
            f"{API_BASE}/outlines/generate",
            json={"presentation_id": presentation_id},
            timeout=120
        )
        response.raise_for_status()
        presentation = response.json()
        print(f"✓ Outlines generated")
    except Exception as e:
        print(f"✗ Failed to generate outlines: {e}")
        return False

    # Step 3: Get the presentation to get slides data
    print("\n[3/4] Getting presentation data...")
    try:
        response = requests.get(
            f"{API_BASE}/presentation",
            params={"presentation_id": presentation_id},
            timeout=30
        )
        response.raise_for_status()
        pres_data = response.json()
        print(f"✓ Got presentation data with {len(pres_data.get('slides', []))} slides")

        # Check if we have the pptx_model in the presentation
        if not pres_data.get('presentation', {}).get('pptx_model'):
            print("⚠ No pptx_model found, may need to generate presentation first")
            return False

        pptx_model = pres_data['presentation']['pptx_model']

    except Exception as e:
        print(f"✗ Failed to get presentation: {e}")
        return False

    # Step 4: Export as PPTX
    print("\n[4/4] Exporting as PPTX...")
    try:
        export_data = {
            "presentation_id": presentation_id,
            "pptx_model": pptx_model
        }
        response = requests.post(
            f"{API_BASE}/presentation/export_as_pptx",
            json=export_data,
            timeout=60
        )
        response.raise_for_status()
        export_result = response.json()
        pptx_path = export_result.get('path')
        print(f"✓ PPTX exported to: {pptx_path}")
    except Exception as e:
        print(f"✗ Failed to export PPTX: {e}")
        if hasattr(e, 'response'):
            print(f"  Response: {e.response.text}")
        return False

    # Step 5: Download the PPTX
    print("\n[5/5] Downloading PPTX...")
    try:
        response = requests.get(
            f"{API_BASE}/presentation/download/{presentation_id}",
            timeout=30
        )
        response.raise_for_status()

        # Save to a file
        output_file = f"test_download_{presentation_id}.pptx"
        with open(output_file, 'wb') as f:
            f.write(response.content)

        file_size = os.path.getsize(output_file)
        print(f"✓ PPTX downloaded successfully ({file_size} bytes) -> {output_file}")

        # Clean up
        os.remove(output_file)

    except Exception as e:
        print(f"✗ Failed to download PPTX: {e}")
        if hasattr(e, 'response'):
            print(f"  Response: {e.response.text}")
        return False

    print("\n" + "=" * 80)
    print("✓ WORKFLOW COMPLETED SUCCESSFULLY")
    print("=" * 80)
    return True

def main():
    """Run the test 3 times"""
    success_count = 0

    for i in range(3):
        print(f"\n\n{'#' * 80}")
        print(f"# TEST RUN {i+1}/3")
        print(f"{'#' * 80}")

        if test_presentation_workflow():
            success_count += 1
            print(f"\n✓ Test {i+1}/3 PASSED")
        else:
            print(f"\n✗ Test {i+1}/3 FAILED")
            break

        if i < 2:
            print("\nWaiting 5 seconds before next test...")
            time.sleep(5)

    print(f"\n\n{'=' * 80}")
    print(f"FINAL RESULTS: {success_count}/3 tests passed")
    print(f"{'=' * 80}")

    return success_count == 3

if __name__ == "__main__":
    success = main()
    sys.exit(0 if success else 1)
