/*
 * SignCard site settings.
 *
 * The Firebase web settings are public by design: Firestore security rules (firebase/firestore.rules)
 * decide what a browser may do. Browsers may only create a new signature; nobody can read, change
 * or delete one from a browser. Leave projectId empty to run in demo mode (nothing is saved).
 */
window.SIGNCARD_CONFIG = {
  firebase: {
    projectId: "trpl-signcard",
    apiKey: "AIzaSyB-749Wq-l7RTY6jhp8ghnlOJ6GV6Ixnx4"
  },
  siteUrl: "https://card.labs.trlibrary.com/"
};
