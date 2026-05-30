// The current LLM/image provider + model badge (e.g. "Google (gemini-3.1-flash-lite) · Pexels")
// is intentionally hidden for the embedded (broker-marketplace) deployment so end
// users don't see the backend provider/model. Rendered as a no-op to avoid touching
// the upload-page layout or its call site.
const CurrentConfig = () => null;

export default CurrentConfig;
