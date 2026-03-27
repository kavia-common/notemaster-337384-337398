/**
 * Frontend configuration.
 *
 * Uses REACT_APP_NOTES_API_BASE_URL to reach the backend.
 * In local dev, you can set it to: http://localhost:3001
 */

export const NOTES_API_BASE_URL =
  process.env.REACT_APP_NOTES_API_BASE_URL || "";
