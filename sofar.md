# PowerPoint Generation Fix - Progress Report

## What I've Done

### 1. **Understanding the System Architecture**
The application has a multi-step PowerPoint generation workflow:
- **Create**: Initialize presentation with prompt, n_slides, language
- **Generate Outlines**: LLM generates slide titles and content outlines
- **Generate Data**: Submit outlines + theme for processing
- **Stream Generation**: LLM generates detailed slide content (SSE stream)
- **Export**: Convert slides to PPTX format
- **Download**: Retrieve the generated PPTX file

Stack:
- Backend: FastAPI (Python) on port 8000
- Frontend: Next.js on port 3000
- LLM: Currently using Google Gemini via OpenAI-compatible API
- Running in Docker container

### 2. **Bugs Found & Fixed**

#### Bug #1: Title Length Validation Error (FIXED ✓)
**Error**: `ValidationError: title - String should have at most 50 characters`

**Root Cause**:
- File: `servers/fastapi/api/utils/variable_length_models.py:24`
- The `PresentationMarkdownModelWithNSlides` model enforces `max_length=50` for titles
- Google Gemini 2.0-flash was generating titles like "AI in Healthcare: Transforming the Future of Medicine" (62 chars)
- Validation failed, returning HTTP 400 to client

**Fix Applied**:
- File: `servers/fastapi/ppt_config_generator/ppt_outlines_generator.py:99-101`
- Added truncation logic: `if len(parsed_json['title']) > 50: parsed_json['title'] = parsed_json['title'][:50]`
- Applied to both Google Vertex AI path and OpenAI manual parsing fallback path

**Test Result**: ✓ PASSED - Generated title "The Transformative Benefits of Quantum Computing" (48 chars)

#### Enhancement: Model Update
- Updated Google model from `gemini-2.0-flash` to `gemini-2.5-flash`
- File: `servers/fastapi/api/utils/model_utils.py:62,72,82`

### 3. **Current Issue: Puppeteer Can't Scrape Slides**

**Problem**:
- The `/api/v1/ppt/generate/presentation` endpoint exists but fails with 400
- Uses Puppeteer to scrape presentation page at `http://localhost/presentation?id={id}`
- Puppeteer returns error: `{"error":"Slide container not found"}`
- File: `servers/nextjs/app/api/slide-metadata/route.ts:157`

**Root Cause**:
- The presentation page loads HTML skeleton but React doesn't hydrate with slide data
- Page shows "Loading configuration..." indefinitely
- Puppeteer waits for `[data-element-type="slide-container"]` selector (timeout: 60s)
- Selector never appears because slides aren't rendering
- No slide containers = no metadata = no pptx_model = export fails

**Architecture**:
```
/api/v1/ppt/generate/presentation (Python)
  ↓ calls
/api/slide-metadata (Next.js)
  ↓ uses Puppeteer to visit
/presentation?id={id} (Next.js Page)
  ↓ should fetch from
/api/v1/ppt/presentation (Python API)
  ↓ returns SlideModel[]
  ↓ React renders slides with data attributes
  ↓ Puppeteer scrapes DOM → pptx_model
  ↓ Python creates PPTX file
```

**Why Slides Don't Render**:
- Could be: Missing .env config that frontend needs
- Could be: Frontend-backend communication issue
- Could be: Database query returning empty slides
- Need to check: Browser console errors, network requests

## What's Next

### Immediate Tasks:
1. **Debug Why Frontend Can't Load Slides**
   - Check .env for missing frontend config (NEXT_PUBLIC_* vars)
   - Test if `/api/v1/ppt/presentation?presentation_id={id}` returns data
   - Check Next.js logs for frontend errors
   - Test presentation page with browser dev tools

2. **Alternative: Bypass Puppeteer Scraping**
   - Option A: Create Python function to convert SlideModel[] → PptxModel directly
   - Option B: Fix the presentation page rendering issue
   - Option C: Increase Puppeteer timeout / add better waiting logic

3. **Complete End-to-End Test**
   - Fix slide rendering or implement alternative
   - Run 3 successful tests: generate → export → download
   - Verify downloaded PPTX files open correctly

### Known Working Endpoints:
- ✓ `/api/v1/ppt/create` - Creates presentation
- ✓ `/api/v1/ppt/outlines/generate` - Generates outlines (after title truncation fix)
- ✓ `/api/v1/ppt/generate/data` - Submits generation data
- ✓ `/api/v1/ppt/generate/stream` - Streams slide generation
- ✓ `/api/v1/ppt/presentation` - Gets presentation + slides
- ✗ `/api/v1/ppt/generate/presentation` - Single endpoint (fails on Puppeteer)
- ✗ `/api/v1/ppt/presentation/download/{id}` - Download (no file exists)

### Potential Additional Issues to Monitor:
- Image/icon asset fetching (mentioned in logs)
- Theme application
- Font rendering
- Any other race conditions or timing issues

## Files Modified:
1. `servers/fastapi/ppt_config_generator/ppt_outlines_generator.py` - Added title truncation (lines 99-101, 140-142)
2. `servers/fastapi/api/utils/model_utils.py` - Updated to Gemini 2.5-flash (lines 62,72,82)

## Test Results:
- Title validation fix: ✓ PASSED (tested with "Benefits of Quantum Computing")
- Multi-step workflow (create → outlines → generate data → stream → get presentation): ✓ PASSED
- Export via Puppeteer scraping: ✗ FAILED (slide containers don't render)
- Download: ✗ FAILED (no PPTX file exists - export never completed)
- Success rate: 0/3 complete end-to-end tests

## Environment:
- Docker container: `presenton-production-1`
- Port 8000: FastAPI backend
- Port 3000: Next.js frontend (proxied via nginx on port 80)
- LLM: Google Gemini 2.5-flash (API key configured)
- Database: SQLite (in container at `/app/user_data/`)

## Recommended Next Steps (Priority Order):

### Option 1: Quick Fix - Increase Puppeteer Timeout & Add Retry Logic
The presentation page might just need more time to load. Modify:
- `servers/nextjs/app/api/slide-metadata/route.ts:122,131`
- Increase timeouts from 60s to 120s
- Add retry logic with exponential backoff
- Add check for API response before scraping

### Option 2: Debug Frontend Data Loading
The root issue is slides not rendering. Check:
1. Browser DevTools → Network tab when visiting `/presentation?id=72c50707...`
2. Check if `/api/v1/ppt/presentation` API call succeeds
3. Check React component state/errors
4. Verify no CORS or auth issues between Next.js ↔ FastAPI

### Option 3: Bypass Puppeteer Entirely (Most Reliable)
Create a Python-only slide→pptx converter:
1. Read SlideModel[] from database
2. Convert to PptxPresentationModel using template/rules
3. Call PptxPresentationCreator directly
4. No frontend dependency, no Puppeteer, no timing issues

This would be the most robust solution for an API-only workflow.
