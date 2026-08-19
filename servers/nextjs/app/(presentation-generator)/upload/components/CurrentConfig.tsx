import React from 'react';

/**
 * Provider/model badge — deliberately renders nothing in this build.
 *
 * It printed the configured text provider, image provider and model id, e.g.
 * "Custom (cursor-grok-4.6-low) · Custom · Web: Default (Model) (Off)". Which
 * model powers Presentations is not a user-facing detail, and the id names the
 * upstream gateway: "cursor" must never appear client-side.
 *
 * Kept as a no-op component rather than deleted so the call site and the prop
 * contract stay intact, and so this reasoning sits where someone would look
 * before re-enabling it.
 */
const CurrentConfig = (_props: { webSearchEnabled: boolean }) => null;

export default CurrentConfig;
