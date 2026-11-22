// The CSP entries the Google Ads conversion tag adds to every public page (scripts/add-ads-tag.js, js/ads-tag.js; owner-approved 2026-11-22).
// Tests that pin a public page's exact CSP build the expectation from these so the tag's allowances live in ONE place.
export const GTM = 'https://www.googletagmanager.com';
export const ADS_IMG = ['https://www.google.com', 'https://googleads.g.doubleclick.net', 'https://www.googleadservices.com'];
export const ADS_CONNECT = [...ADS_IMG, 'https://*.google.com'];
export const ADS_FRAME = ['https://td.doubleclick.net', GTM];
