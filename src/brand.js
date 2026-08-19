// Single source of truth for product branding. Change it here and it updates
// the sidebar, the sign-in screen, the page title and the MFA enrolment label.
export const BRAND = {
  name: 'Zoom17',
  tagline: 'One platform to connect',
  // Wordmark colours: deep navy for the word, bright blue for the accent.
  navy: '#16277B',
  blue: '#1A6CFF',
  // On dark backgrounds the navy disappears, so the wordmark inverts to these.
  invertedNavy: '#FFFFFF',
  invertedBlue: '#6BA4FF',

  /* To use an exact logo export instead of the drawn wordmark, drop the file in
     `public/brand/` and point these at it, e.g.:
       logoSrc: '/brand/zoom17.svg',
       logoSrcInverted: '/brand/zoom17-white.svg',   // optional, for dark panels
     Leave them null to keep the built-in vector wordmark, which draws BRAND.name
     directly and so needs no new artwork when the product name changes. */
  logoSrc: null,
  logoSrcInverted: null,
}
