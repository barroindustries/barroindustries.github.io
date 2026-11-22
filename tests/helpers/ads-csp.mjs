// The CSP entries the Google Ads conversion tag adds to every public page (scripts/add-ads-tag.js, js/ads-tag.js; owner-approved 2026-11-22).
// Tests that pin a public page's exact CSP build the expectation from these so the tag's allowances live in ONE place.
export const GTM = 'https://www.googletagmanager.com';
export const META_JS = 'https://connect.facebook.net';   // Meta pixel, owner-approved 2026-11-22
export const META = 'https://www.facebook.com';
export const ADS_SCRIPT = [GTM, META_JS];
export const ADS_IMG = ['https://www.google.com', 'https://googleads.g.doubleclick.net', 'https://www.googleadservices.com', META];
export const ADS_CONNECT = ['https://www.google.com', 'https://googleads.g.doubleclick.net', 'https://www.googleadservices.com', 'https://*.google.com', META, META_JS];
export const ADS_FRAME = ['https://td.doubleclick.net', GTM];
